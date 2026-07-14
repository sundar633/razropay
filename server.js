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


// 🔥 TEST ROUTE
app.get("/", (req, res) => {

  res.send("Backend Running");

});


// 🔥 CREATE ORDER
app.post("/create-order", async (req, res) => {

  try {

    // 🔥 amount from frontend
    const amount = req.body.amount;

    const options = {

      amount: amount,

      currency: "INR",

      receipt: "receipt_order"

    };

    // 🔥 create razorpay order
    const order =
      await razorpay.orders.create(options);

    // 🔥 send response
    res.json({

      success: true,

      order: order

    });

  }

  catch (err) {

    console.log(err);

    res.status(500).json({

      success: false,

      message: "Order creation failed"

    });

  }

});


// 🔥 PORT
const PORT =
  process.env.PORT || 5000;

// 🔥 CREATE PAYMENT QR
app.post("/create-qr", async (req, res) => {

  try{

    const amount = Number(req.body.amount);

    if(!amount || amount <= 0){

      return res.status(400).json({
        success:false,
        message:"Invalid amount"
      });

    }

    const qr = await razorpay.qrCode.create({

      type:"upi_qr",

      name:"Payment",

      usage:"single_use",

      fixed_amount:true,

      payment_amount:amount,

      description:`Payment ₹${amount / 100}`

    });

    res.json({

      success:true,

      qr

    });

  }catch(error){

    console.log(error);

    res.status(500).json({

      success:false,

      message:"QR creation failed"

    });

  }

});
// 🔥 START SERVER
app.listen(PORT, () => {

  console.log("Server Started");

});
