import API from "./api";

export const getSensors = () => API.get("/sensor");
export const addSensor = (data) => API.post("/sensor", data);