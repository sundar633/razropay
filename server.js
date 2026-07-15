const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================
   RAZORPAY CONFIGURATION
========================================= */

if (!process.env.KEY_ID || !process.env.KEY_SECRET) {
  console.error(
    "Missing Razorpay KEY_ID or KEY_SECRET environment variables"
  );
}

const razorpay = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET
});

/* =========================================
   TEST ROUTE
========================================= */

app.get("/", (req, res) => {
  res.send("Backend Running");
});

/* =========================================
   CREATE RAZORPAY ORDER
========================================= */

app.post("/create-order", async (req, res) => {
  try {
    const amount = Number(req.body.amount);

    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount"
      });
    }

    const order = await razorpay.orders.create({
      amount: amount,
      currency: "INR",
      receipt: `receipt_${Date.now()}`
    });

    return res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error(
      "Order creation error:",
      error?.error || error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.error?.description ||
        "Order creation failed"
    });
  }
});

/* =========================================
   CREATE SINGLE-USE UPI QR
========================================= */

app.post("/create-qr", async (req, res) => {
  try {
    /*
      Amount must come in paise.

      Example:
      ₹1   = 100
      ₹50  = 5000
      ₹100 = 10000
    */

    const amount = Number(req.body.amount);

    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount"
      });
    }

    const qr = await razorpay.qrCode.create({
      type: "upi_qr",
      name: `Payment ${Date.now()}`,
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amount,
      description: `Payment ₹${(
        amount / 100
      ).toFixed(2)}`
    });

    return res.json({
      success: true,

      qr_id: qr.id,
      image_url: qr.image_url,
      status: qr.status,
      amount: qr.payment_amount,

      qr
    });
  } catch (error) {
    console.error(
      "QR creation error:",
      error?.error || error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.error?.description ||
        "QR creation failed"
    });
  }
});

/* =========================================
   CHECK QR PAYMENT STATUS
========================================= */

app.get(
  "/payment-status/:qrId",
  async (req, res) => {
    try {
      const qrId = req.params.qrId;

      if (
        !qrId ||
        !qrId.startsWith("qr_")
      ) {
        return res.status(400).json({
          success: false,
          paid: false,
          message: "Invalid QR ID"
        });
      }

      /*
        Razorpay endpoint:

        GET
        /v1/payments/qr_codes/:qrId/payments
      */

      const authorization =
        Buffer.from(
          `${process.env.KEY_ID}:${process.env.KEY_SECRET}`
        ).toString("base64");

      const razorpayResponse = await fetch(
        `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(
          qrId
        )}/payments`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Basic ${authorization}`,

            "Content-Type":
              "application/json"
          }
        }
      );

      const paymentData =
        await razorpayResponse.json();

      if (!razorpayResponse.ok) {
        console.error(
          "Payment status Razorpay error:",
          paymentData
        );

        return res
          .status(razorpayResponse.status)
          .json({
            success: false,
            paid: false,
            message:
              paymentData?.error?.description ||
              "Unable to check payment status"
          });
      }

      const payments =
        Array.isArray(paymentData.items)
          ? paymentData.items
          : [];

      /*
        Only captured payments are treated
        as successful.
      */

      const successfulPayment =
        payments.find(
          payment =>
            payment.status === "captured"
        );

      if (successfulPayment) {
        return res.json({
          success: true,
          paid: true,
          status: "captured",

          payment_id:
            successfulPayment.id,

          amount:
            successfulPayment.amount,

          method:
            successfulPayment.method,

          created_at:
            successfulPayment.created_at,

          payment:
            successfulPayment
        });
      }

      /*
        A payment may temporarily remain
        authorized before capture.
      */

      const authorizedPayment =
        payments.find(
          payment =>
            payment.status === "authorized"
        );

      if (authorizedPayment) {
        return res.json({
          success: true,
          paid: false,
          processing: true,
          status: "authorized",

          message:
            "Payment received and processing",

          payment_id:
            authorizedPayment.id
        });
      }

      return res.json({
        success: true,
        paid: false,
        processing: false,
        status: "pending",
        message: "Payment not completed yet"
      });
    } catch (error) {
      console.error(
        "Payment status error:",
        error
      );

      return res.status(500).json({
        success: false,
        paid: false,
        message:
          "Payment status checking failed"
      });
    }
  }
);

/* =========================================
   FETCH QR DETAILS
========================================= */

app.get("/qr-details/:qrId", async (req, res) => {
  try {
    const qrId = req.params.qrId;

    if (
      !qrId ||
      !qrId.startsWith("qr_")
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid QR ID"
      });
    }

    const qr =
      await razorpay.qrCode.fetch(qrId);

    return res.json({
      success: true,
      qr
    });
  } catch (error) {
    console.error(
      "QR fetch error:",
      error?.error || error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.error?.description ||
        "Unable to fetch QR details"
    });
  }
});

/* =========================================
   START SERVER
========================================= */

const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server Started on port ${PORT}`
  );
});
