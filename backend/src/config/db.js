const mongoose = require("mongoose");

const connectDB = async () => {
  await mongoose.connect("mongodb://localhost:27017/cinnamonDB");
  console.log("MongoDB Connected");
};

module.exports = connectDB;