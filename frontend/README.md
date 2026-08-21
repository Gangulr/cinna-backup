# AI-Driven Smart Cinnamon Growth Monitoring & Automated Harvesting System

## Project Overview
This project is an AI-driven smart agriculture system designed for cinnamon cultivation. The system supports cinnamon growth monitoring, disease detection, harvest-readiness prediction, and automated harvesting support using IoT, machine learning, computer vision, and a web-based dashboard.

## Research Group
**Group ID:** R26-IT-102
**Project Type:** 4th Year Research Project
**Institution:** Sri Lanka Institute of Information Technology (SLIIT)

## Main Features
- Cinnamon disease detection using image-based AI model
- Cinnamon growth prediction using sensor-based machine learning
- Harvest-readiness and bark-thickness prediction
- AI-guided robotic harvesting workflow
- Real-time dashboard for monitoring and analytics
- Prediction history management
- Firebase/Firestore data storage integration

## System Components
1. **Disease Detection Module**
   Identifies cinnamon leaf, bark, and root diseases using uploaded images.

2. **Growth Prediction Module**
   Predicts cinnamon plant growth using environmental sensor values such as temperature, humidity, and soil moisture.

3. **Harvest Readiness Prediction Module**
   Supports decision-making by predicting the suitable harvesting stage.

4. **AI-Guided Robotic Harvesting Module**
   Detects bark boundaries and generates harvesting guidance for the robotic harvesting process.

## Technologies Used

### Frontend
- Next.js
- React.js
- Tailwind CSS
- TypeScript

### Backend
- FastAPI
- Python
- Machine Learning Models

### Database / Cloud
- Firebase
- Firestore

### Machine Learning
- CNN-based image classification
- Random Forest Regression
- Computer Vision techniques

## Repository Structure
```bash
project-root/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── public/
│   └── package.json
│
├── backend/
│   ├── main.py
│   ├── models/
│   ├── dataset/
│   └── requirements.txt
│
└── README.mdThis is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

How to Run the Project
Frontend
cd frontend
npm install
npm run dev

Frontend runs on:

http://localhost:3000

Backend
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8001

Backend runs on:

http://localhost:8001
API Endpoints4

| Endpoint            | Method | Description                                    |
| ------------------- | ------ | ---------------------------------------------- |
| `/disease-predict/` | POST   | Predicts cinnamon disease using uploaded image |
| `/growth-predict/`  | POST   | Predicts cinnamon growth using sensor inputs   |
| `/history/`         | GET    | Retrieves saved prediction history             |
| `/dashboard/`       | GET    | Retrieves dashboard analytics data             |

PP1 Completed Work

By the PP1 presentation stage, the following work was completed:

Project frontend structure created
Disease prediction UI completed
Growth prediction UI completed
FastAPI backend connected
Initial ML models trained and tested
Firebase/Firestore prediction history implemented
Dashboard cards and analytics section developed
Basic robotic harvesting prototype UI designed

Future Improvements
Improve model accuracy using larger cinnamon-specific datasets
Add real-time IoT sensor integration
Connect live camera support for robotic harvesting
Improve dashboard analytics and visualization
Add user authentication and role-based access
Deploy the system online

Team Members
| Name              | Role                  |
| ---------------   | --------------------- |
| Gangul Ranaweera  | Research Group Member |
| Hansana Wanasinghe| Research Group Member |
| Januli Samaraweera| Research Group Member |

Supervisor
Supervisor: Mr.S.M.B. Harshanath
License

This project is developed for academic research purposes.


### How to add README.md to GitHub

In your project folder:

```bash
touch README.md

Open the file in VS Code, paste the content, then run:

git add README.md
git commit -m "Add README file for PP1 checklist"
git push
