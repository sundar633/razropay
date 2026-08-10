const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

/* =========================================
   MIDDLEWARE
========================================= */

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({
  limit: "1mb"
}));


/* =========================================
   RAZORPAY CONFIGURATION
========================================= */

const KEY_ID = process.env.KEY_ID;
const KEY_SECRET = process.env.KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {

  console.error(
    "Missing Razorpay KEY_ID or KEY_SECRET environment variables"
  );

}

const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET
});


/* =========================================
   TEST / HEALTH ROUTE
========================================= */

app.get("/", (req, res) => {

  return res.status(200).json({
    success: true,
    message: "CEZOO Razorpay Backend Running"
  });

});


/* =========================================
   CREATE RAZORPAY ORDER
========================================= */

app.post("/create-order", async (req, res) => {

  try {

    if (!KEY_ID || !KEY_SECRET) {

      return res.status(500).json({
        success: false,
        message: "Payment service configuration error"
      });

    }


    const amount = Number(req.body.amount);


    /*
      Amount must be in paise.

      ₹1   = 100
      ₹50  = 5000
      ₹100 = 10000
    */

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({
        success: false,
        message: "Invalid amount"
      });

    }


    const receipt =
      `cezoo_${Date.now()}_${Math.floor(
        Math.random() * 100000
      )}`;


    const order =
      await razorpay.orders.create({

        amount: amount,

        currency: "INR",

        receipt: receipt

      });


    if (!order || !order.id) {

      console.error(
        "Razorpay returned invalid order:",
        order
      );

      return res.status(502).json({
        success: false,
        message: "Unable to create payment order"
      });

    }


    console.log(
      "Razorpay order created:",
      order.id
    );


    return res.status(200).json({

      success: true,

      order: order

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
        error?.message ||
        "Order creation failed"

    });

  }

});


/* =========================================
   VERIFY NORMAL RAZORPAY CHECKOUT PAYMENT
========================================= */

app.post("/verify-payment", async (req, res) => {

  try {

    if (!KEY_SECRET) {

      return res.status(500).json({
        success: false,
        verified: false,
        message: "Payment service configuration error"
      });

    }


    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};


    /*
      Validate required values.
    */

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !razorpay_order_id.trim() ||
      !razorpay_payment_id.trim() ||
      !razorpay_signature.trim()
    ) {

      return res.status(400).json({

        success: false,

        verified: false,

        message: "Missing payment verification details"

      });

    }


    /*
      Razorpay signature:

      HMAC SHA256

      order_id | payment_id
    */

    const signatureBody =
      `${razorpay_order_id}|${razorpay_payment_id}`;


    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          KEY_SECRET
        )
        .update(signatureBody)
        .digest("hex");


    /*
      Timing-safe comparison.
    */

    const receivedBuffer =
      Buffer.from(
        razorpay_signature,
        "utf8"
      );


    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );


    let signatureValid = false;


    if (
      receivedBuffer.length ===
      expectedBuffer.length
    ) {

      signatureValid =
        crypto.timingSafeEqual(
          receivedBuffer,
          expectedBuffer
        );

    }


    if (!signatureValid) {

      console.error(
        "Razorpay signature verification failed:",
        {
          order_id:
            razorpay_order_id,

          payment_id:
            razorpay_payment_id
        }
      );


      return res.status(400).json({

        success: false,

        verified: false,

        message: "Payment verification failed"

      });

    }


    /*
      Fetch the payment directly from Razorpay.

      This gives us an additional server-side
      confirmation that payment really exists.
    */

    const payment =
      await razorpay.payments.fetch(
        razorpay_payment_id
      );


    if (!payment || !payment.id) {

      return res.status(404).json({

        success: false,

        verified: false,

        message: "Payment could not be found"

      });

    }


    /*
      Ensure this payment actually belongs
      to the same Razorpay order.
    */

    if (
      String(payment.order_id || "") !==
      String(razorpay_order_id)
    ) {

      console.error(
        "Payment/order mismatch:",
        {
          receivedOrder:
            razorpay_order_id,

          paymentOrder:
            payment.order_id,

          paymentId:
            razorpay_payment_id
        }
      );


      return res.status(400).json({

        success: false,

        verified: false,

        message: "Payment order mismatch"

      });

    }


    /*
      CAPTURED = payment completed.

      AUTHORIZED can still be processing,
      so do NOT treat it exactly like a
      completed captured payment.
    */

    if (payment.status === "captured") {

      console.log(
        "Payment verified and captured:",
        payment.id
      );


      return res.status(200).json({

        success: true,

        verified: true,

        paid: true,

        processing: false,

        status: "captured",

        order_id:
          razorpay_order_id,

        payment_id:
          razorpay_payment_id,

        amount:
          payment.amount,

        currency:
          payment.currency,

        method:
          payment.method,

        captured:
          payment.captured === true

      });

    }


    /*
      Payment received but capture
      not completed yet.
    */

    if (payment.status === "authorized") {

      console.log(
        "Payment authorized:",
        payment.id
      );


      return res.status(200).json({

        success: true,

        verified: true,

        paid: false,

        processing: true,

        status: "authorized",

        order_id:
          razorpay_order_id,

        payment_id:
          razorpay_payment_id,

        amount:
          payment.amount,

        currency:
          payment.currency,

        method:
          payment.method,

        message:
          "Payment is authorized and processing"

      });

    }


    /*
      Other statuses such as failed.
    */

    return res.status(200).json({

      success: true,

      verified: true,

      paid: false,

      processing: false,

      status:
        payment.status || "unknown",

      order_id:
        razorpay_order_id,

      payment_id:
        razorpay_payment_id,

      message:
        "Payment is not captured"

    });


  } catch (error) {

    console.error(
      "Payment verification error:",
      error?.error || error
    );


    return res.status(500).json({

      success: false,

      verified: false,

      message:
        error?.error?.description ||
        error?.message ||
        "Payment verification failed"

    });

  }

});


/* =========================================
   CREATE SINGLE-USE UPI QR
========================================= */

app.post("/create-qr", async (req, res) => {

  try {

    if (!KEY_ID || !KEY_SECRET) {

      return res.status(500).json({

        success: false,

        message:
          "Payment service configuration error"

      });

    }


    /*
      Amount must come in paise.

      Example:

      ₹1   = 100
      ₹50  = 5000
      ₹100 = 10000
    */

    const amount =
      Number(req.body.amount);


    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({

        success: false,

        message: "Invalid amount"

      });

    }


    const qr =
      await razorpay.qrCode.create({

        type: "upi_qr",

        name:
          `CEZOO Payment ${Date.now()}`,

        usage:
          "single_use",

        fixed_amount:
          true,

        payment_amount:
          amount,

        description:
          `CEZOO Payment ₹${(
            amount / 100
          ).toFixed(2)}`

      });


    if (!qr || !qr.id) {

      return res.status(502).json({

        success: false,

        message:
          "Unable to create QR code"

      });

    }


    console.log(
      "QR created:",
      qr.id
    );


    return res.status(200).json({

      success: true,

      qr_id:
        qr.id,

      image_url:
        qr.image_url,

      status:
        qr.status,

      amount:
        qr.payment_amount,

      qr:
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
        error?.message ||
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

      const qrId =
        String(
          req.params.qrId || ""
        ).trim();


      if (
        !qrId ||
        !qrId.startsWith("qr_")
      ) {

        return res.status(400).json({

          success: false,

          paid: false,

          processing: false,

          message: "Invalid QR ID"

        });

      }


      if (!KEY_ID || !KEY_SECRET) {

        return res.status(500).json({

          success: false,

          paid: false,

          processing: false,

          message:
            "Payment service configuration error"

        });

      }


      /*
        Fetch payments made to this QR.
      */

      const authorization =
        Buffer
          .from(
            `${KEY_ID}:${KEY_SECRET}`
          )
          .toString("base64");


      const razorpayResponse =
        await fetch(

          `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(
            qrId
          )}/payments`,

          {

            method: "GET",

            headers: {

              Authorization:
                `Basic ${authorization}`,

              Accept:
                "application/json"

            }

          }

        );


      let paymentData;


      try {

        paymentData =
          await razorpayResponse.json();

      } catch {

        paymentData = null;

      }


      if (!razorpayResponse.ok) {

        console.error(
          "QR status Razorpay error:",
          paymentData
        );


        return res
          .status(
            razorpayResponse.status
          )
          .json({

            success: false,

            paid: false,

            processing: false,

            message:
              paymentData
                ?.error
                ?.description ||
              "Unable to check payment status"

          });

      }


      const payments =
        Array.isArray(
          paymentData?.items
        )
          ? paymentData.items
          : [];


      /*
        Find captured payment first.
      */

      const capturedPayment =
        payments.find(
          payment =>
            payment &&
            payment.status ===
              "captured"
        );


      if (capturedPayment) {

        console.log(
          "QR payment captured:",
          capturedPayment.id
        );


        return res.status(200).json({

          success: true,

          paid: true,

          processing: false,

          status: "captured",

          qr_id: qrId,

          payment_id:
            capturedPayment.id,

          amount:
            capturedPayment.amount,

          currency:
            capturedPayment.currency,

          method:
            capturedPayment.method,

          created_at:
            capturedPayment.created_at,

          payment:
            capturedPayment

        });

      }


      /*
        Payment can temporarily remain
        authorized before capture.
      */

      const authorizedPayment =
        payments.find(
          payment =>
            payment &&
            payment.status ===
              "authorized"
        );


      if (authorizedPayment) {

        return res.status(200).json({

          success: true,

          paid: false,

          processing: true,

          status: "authorized",

          qr_id: qrId,

          payment_id:
            authorizedPayment.id,

          amount:
            authorizedPayment.amount,

          message:
            "Payment received and processing"

        });

      }


      /*
        No successful payment yet.
      */

      return res.status(200).json({

        success: true,

        paid: false,

        processing: false,

        status: "pending",

        qr_id: qrId,

        message:
          "Payment not completed yet"

      });


    } catch (error) {

      console.error(
        "QR payment status error:",
        error?.error || error
      );


      return res.status(500).json({

        success: false,

        paid: false,

        processing: false,

        message:
          error?.error?.description ||
          error?.message ||
          "Payment status checking failed"

      });

    }

  }
);


/* =========================================
   FETCH QR DETAILS
========================================= */

app.get(
  "/qr-details/:qrId",
  async (req, res) => {

    try {

      const qrId =
        String(
          req.params.qrId || ""
        ).trim();


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
        await razorpay.qrCode.fetch(
          qrId
        );


      if (!qr || !qr.id) {

        return res.status(404).json({

          success: false,

          message:
            "QR code not found"

        });

      }


      return res.status(200).json({

        success: true,

        qr: qr

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
          error?.message ||
          "Unable to fetch QR details"

      });

    }

  }
);


/* =========================================
   404 ROUTE
========================================= */

app.use((req, res) => {

  return res.status(404).json({

    success: false,

    message: "Route not found"

  });

});


/* =========================================
   EXPRESS ERROR HANDLER
========================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "Backend error:",
      error
    );


    if (res.headersSent) {

      return next(error);

    }


    return res.status(500).json({

      success: false,

      message:
        "Internal server error"

    });

  }
);


/* =========================================
   START SERVER
========================================= */

const PORT =
  process.env.PORT || 5000;


app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `CEZOO Razorpay Backend Started on port ${PORT}`
    );

  }
);
