"""Guidance ownership, caching and failure checks without cloud/provider I/O."""
import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from google.api_core.exceptions import ServiceUnavailable
from hybrid_disease.gemini_service import GeminiServiceConfig
from plant_condition.care import care_details, enrich_check
from plant_condition.guidance import GuidanceService
from tests import test_interactive_condition as interactive_tests


class FakeClient:
    def __init__(self, delay=0, error=None, transform=None):
        self.calls = []
        self.delay, self.error, self.transform = delay, error, transform
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate))

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        context = json.loads(kwargs['contents'])
        prose = dict(context['approved_guidance'])
        prose.pop('source')
        prose['assessment_status'] = context['status']
        return SimpleNamespace(parsed=self.transform(prose) if self.transform else prose)


class ConditionGuidanceTests(unittest.IsolatedAsyncioTestCase):
    setUp = interactive_tests.InteractiveConditionTests.setUp

    def saved_check(self, **changes):
        return self.client.post('/plant-condition-check', json=interactive_tests.payload(**changes), headers=self.headers).json()

    def adapter(self, client, **changes):
        config = replace(GeminiServiceConfig(True, 'test-key', 'test-model', 1, 2, 3, 120), **changes)
        adapter = GuidanceService(self.store, self.baseline, config, client)
        self.service.guidance = adapter
        return adapter

    async def test_success_cached_without_identity_or_status_changes(self):
        record = self.saved_check(plant_id='private-plant-label')
        client = FakeClient()
        adapter = self.adapter(client)
        result = await adapter.get(record['record_id'], 'alice')
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(await adapter.get(record['record_id'], 'alice'), result)
        self.assertEqual(len(client.calls), 1)
        context = json.loads(client.calls[0]['contents'])
        self.assertEqual(set(context), {'status', 'sensor_findings', 'measurement_context', 'approved_guidance'})
        self.assertNotIn('alice', client.calls[0]['contents'])
        self.assertNotIn('private-plant-label', client.calls[0]['contents'])
        saved = self.store.check(record['record_id'], 'alice')
        self.assertEqual(saved['status'], record['status'])
        self.assertEqual(saved['anomaly_score'], record['anomaly_score'])
        self.assertEqual(saved['care_guidance'], result['guidance'])
        self.assertEqual(result['guidance']['provider'], 'Gemini')

    async def test_concurrent_requests_share_one_provider_call(self):
        record = self.saved_check()
        client = FakeClient(delay=.05)
        adapter = self.adapter(client)
        results = await asyncio.gather(*(adapter.get(record['record_id'], 'alice') for _ in range(4)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(len(client.calls), 1)
        await asyncio.sleep(0)
        self.assertEqual(adapter.pending, {})

    async def test_gemini_three_has_low_reasoning_and_room_for_complete_json(self):
        record = self.saved_check()
        client = FakeClient()
        result = await self.adapter(client, model='gemini-3-test').get(record['record_id'], 'alice')
        self.assertEqual(result['status'], 'ready')
        config = client.calls[0]['config']
        self.assertEqual(config.max_output_tokens, 2048)
        self.assertEqual(config.thinking_config.thinking_level.value, 'LOW')

    async def test_truncated_provider_output_is_rejected(self):
        record = self.saved_check()
        class TruncatedClient(FakeClient):
            async def generate(self, **kwargs):
                response = await super().generate(**kwargs)
                response.candidates = [SimpleNamespace(finish_reason='MAX_TOKENS')]
                return response
        result = await self.adapter(TruncatedClient()).get(record['record_id'], 'alice')
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('care_guidance', self.store.check(record['record_id'], 'alice'))

    async def test_ownership_including_admin_cached_guidance_and_endpoint_validation(self):
        record = self.saved_check()
        client = FakeClient()
        adapter = self.adapter(client)
        await adapter.get(record['record_id'], 'alice')
        for uid in ['bob', 'admin']:
            response = self.client.post(f"/plant-condition-checks/{record['record_id']}/guidance", headers={'Authorization': f'Bearer {uid}'})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post(f"/plant-condition-checks/{record['record_id']}/guidance").status_code, 401)
        self.assertEqual(self.client.post('/plant-condition-checks/bad/guidance', headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post('/plant-condition-checks/' + 'f'*64 + '/guidance', headers=self.headers).status_code, 404)
        self.assertEqual(len(client.calls), 1)

    async def test_disabled_missing_credentials_and_timeout_preserve_assessment(self):
        for changes in [{'enabled': False}, {'api_key': ''}, {'model': ''}, {'timeout_seconds': .005}]:
            record = self.saved_check()
            client = FakeClient(delay=.03)
            result = await self.adapter(client, **changes).get(record['record_id'], 'alice')
            self.assertEqual(result['status'], 'unavailable')
            self.assertEqual(self.store.check(record['record_id'], 'alice')['status'], record['status'])
            if 'timeout_seconds' not in changes:
                self.assertEqual(client.calls, [])

    async def test_invalid_or_unsupported_prose_is_rejected(self):
        def unexpected_action(prose):
            prose['recommended_actions'][0]['action_id'] = 'drainage'
            return prose
        for transform in [
            lambda value: {**value, 'assessment_status': 'ATTENTION'},
            lambda value: {**value, 'summary': 'The plant is healthy and disease-free.'},
            lambda value: {**value, 'follow_up': 'Apply 5 litres of water to the plant.'},
            unexpected_action, lambda value: {**value, 'unsupported': True},
        ]:
            record = self.saved_check()
            result = await self.adapter(FakeClient(transform=transform)).get(record['record_id'], 'alice')
            self.assertEqual(result['status'], 'unavailable')
            self.assertNotIn('care_guidance', self.store.check(record['record_id'], 'alice'))

    async def test_provider_and_storage_failure_keep_basic_guidance(self):
        record = self.saved_check()
        result = await self.adapter(FakeClient(error=RuntimeError('private-provider'))).get(record['record_id'], 'alice')
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('private-provider', json.dumps(result))
        with patch.object(self.store, 'save_guidance', side_effect=ServiceUnavailable('private-storage')):
            result = await self.adapter(FakeClient()).get(record['record_id'], 'alice')
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(self.store.check(record['record_id'], 'alice')['basic_guidance'], record['basic_guidance'])

    async def test_comparisons_come_from_metadata_and_combination_remains_a_combination(self):
        record = self.saved_check(moisture=70)
        moisture = next(item for item in record['sensor_findings'] if item['feature'] == 'moisture')
        self.assertEqual(moisture['comparison'], 'above_baseline')
        self.assertEqual(moisture['baseline_max'], self.baseline.metadata['training_ranges']['moisture']['max'])
        self.assertEqual(record['status'], 'UNKNOWN')
        with patch.object(self.baseline.model, 'score_samples', return_value=[-1]):
            unusual = self.saved_check()
        self.assertEqual(unusual['status'], 'ATTENTION')
        self.assertTrue(all(item['comparison'] == 'within_baseline' for item in unusual['sensor_findings']))
        self.assertIn('combination is unusual', unusual['basic_guidance']['summary'])
        self.baseline.model = None
        unavailable = self.saved_check()
        self.assertEqual(unavailable['status'], 'UNKNOWN')
        self.assertTrue(all(item['comparison'] == 'unavailable' for item in unavailable['sensor_findings']))

    async def test_legacy_checks_and_different_model_versions_are_readable(self):
        record = self.saved_check()
        record.pop('sensor_findings')
        record.pop('basic_guidance')
        original = dict(record)
        self.assertIn('basic_guidance', enrich_check(record, self.baseline))
        self.assertEqual(record, original)
        record['model_version'] = 'older-model'
        self.assertTrue(all(item['baseline_min'] is None for item in care_details(record, self.baseline)['sensor_findings']))


if __name__ == '__main__':
    unittest.main()
