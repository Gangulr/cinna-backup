// components/StatCard.tsx
type Props = {
    title: string;
    value: string;
  };

  export default function StatCard({ title, value }: Props) {
    return (
      <div className="bg-green-500 text-white p-6 rounded-2xl shadow-lg hover:scale-105 transition">
        <h2 className="text-lg">{title}</h2>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    );
  }
