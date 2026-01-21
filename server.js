import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---- MongoDB connection ----  \\
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// ---- Schema: live bus positions ----  \\
const busPositionSchema = new mongoose.Schema(
  {
    bus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bus",
      required: true,
      unique: true,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        index: "2dsphere",
      },
    },
  },
  {
    timestamps: true,
  },
);

const BusPosition = mongoose.model("BusPosition", busPositionSchema);

// ---- Endpoint: receive GPS updates ----  \\
app.post("/api/bus-positions", async (req, res) => {
  const { busId, lat, lng } = req.body;

  if (!busId || lat == null || lng == null) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  try {
    await BusPosition.findOneAndUpdate(
      { bus: busId },
      {
        location: {
          type: "Point",
          coordinates: [lng, lat], 
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    res.status(200).json({ message: "Position updated" });
  } catch (err) {
    res.status(500).json({ message: err });
  }
});

// ---- Start server ----  \\
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
