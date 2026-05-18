const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET,
});

app.get("/", (req, res) => {
  res.send("Backend Running");
});

app.post("/create-order", async (req, res) => {

  try {

    const options = {
      amount: 1000,
      currency: "INR",
    };

    const order = await razorpay.orders.create(options);

    res.json(order);

  } catch (err) {
    console.log(err);
    res.status(500).send("Error");
  }

});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server Started");
});
