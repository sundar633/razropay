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

      key_id: KEY_ID,

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
   CHECK PAYMENT STATUS FOR RAZORPAY ORDER
   Used by CEZOO custom UPI app flow.

   IMPORTANT:
   - Returning to CEZOO from a UPI app is NOT treated as success.
   - A payment is successful only when Razorpay reports it as captured.
   - This route never exposes KEY_SECRET to the client.
========================================= */
app.post("/check-payment", async (req, res) => {

  res.set("Cache-Control", "no-store");

  try {

    if (!KEY_ID || !KEY_SECRET) {

      return res.status(500).json({
        success: false,
        paid: false,
        processing: false,
        message: "Payment service configuration error"
      });

    }


    const orderId = String(
      req.body?.razorpay_order_id ||
      req.body?.order_id ||
      ""
    ).trim();


    if (
      !orderId ||
      !/^order_[A-Za-z0-9]+$/.test(orderId)
    ) {

      return res.status(400).json({
        success: false,
        paid: false,
        processing: false,
        message: "Invalid Razorpay order ID"
      });

    }


    /*
      Fetch the order first so the server knows
      the expected amount and currency.
    */
    const order = await razorpay.orders.fetch(orderId);


    if (!order || !order.id) {

      return res.status(404).json({
        success: false,
        paid: false,
        processing: false,
        message: "Payment order not found"
      });

    }


    const expectedAmount = Number(order.amount);
    const expectedCurrency = String(
      order.currency || "INR"
    ).toUpperCase();


    if (
      !Number.isSafeInteger(expectedAmount) ||
      expectedAmount <= 0
    ) {

      console.error(
        "Invalid amount on Razorpay order:",
        orderId,
        order.amount
      );

      return res.status(502).json({
        success: false,
        paid: false,
        processing: false,
        message: "Invalid payment order amount"
      });

    }


    /*
      Optional client amount check.
      If the frontend sends amount, it must be in paise.
    */
    if (req.body?.amount !== undefined) {

      const clientAmount = Number(req.body.amount);

      if (
        !Number.isSafeInteger(clientAmount) ||
        clientAmount <= 0 ||
        clientAmount !== expectedAmount
      ) {

        return res.status(400).json({
          success: false,
          paid: false,
          processing: false,
          message: "Payment amount mismatch"
        });

      }

    }


    const authorization =
      Buffer
        .from(`${KEY_ID}:${KEY_SECRET}`)
        .toString("base64");


    const razorpayResponse = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: "application/json"
        }
      }
    );


    let paymentData = null;

    try {
      paymentData = await razorpayResponse.json();
    } catch {
      paymentData = null;
    }


    if (!razorpayResponse.ok) {

      console.error(
        "Razorpay order payment-status error:",
        paymentData
      );

      return res
        .status(razorpayResponse.status)
        .json({
          success: false,
          paid: false,
          processing: false,
          message:
            paymentData?.error?.description ||
            "Unable to check payment status"
        });

    }


    const payments = Array.isArray(paymentData?.items)
      ? paymentData.items
      : [];


    /*
      Captured is the only final success state.
      Prefer the newest captured payment if multiple attempts exist.
    */
    const capturedPayment = payments
      .filter(payment =>
        payment &&
        payment.status === "captured"
      )
      .sort(
        (a, b) =>
          Number(b.created_at || 0) -
          Number(a.created_at || 0)
      )[0];


    if (capturedPayment) {

      const paymentAmount =
        Number(capturedPayment.amount);

      const paymentCurrency = String(
        capturedPayment.currency || ""
      ).toUpperCase();

      const paymentOrderId = String(
        capturedPayment.order_id || ""
      );


      if (
        paymentOrderId !== orderId ||
        paymentAmount !== expectedAmount ||
        paymentCurrency !== expectedCurrency
      ) {

        console.error(
          "Captured payment validation mismatch:",
          {
            orderId,
            paymentOrderId,
            expectedAmount,
            paymentAmount,
            expectedCurrency,
            paymentCurrency
          }
        );

        return res.status(409).json({
          success: false,
          paid: false,
          processing: false,
          message: "Captured payment validation failed"
        });

      }


      console.log(
        "Order payment captured:",
        orderId,
        capturedPayment.id
      );


      return res.status(200).json({
        success: true,
        verified: true,
        paid: true,
        processing: false,
        status: "captured",
        order_id: orderId,
        payment_id: capturedPayment.id,
        amount: paymentAmount,
        currency: paymentCurrency,
        method: capturedPayment.method || null,
        vpa: capturedPayment.vpa || null,
        created_at: capturedPayment.created_at || null
      });

    }


    /*
      Authorized means Razorpay has received the payment
      but capture has not completed yet.
    */
    const authorizedPayment = payments
      .filter(payment =>
        payment &&
        payment.status === "authorized"
      )
      .sort(
        (a, b) =>
          Number(b.created_at || 0) -
          Number(a.created_at || 0)
      )[0];


    if (authorizedPayment) {

      return res.status(200).json({
        success: true,
        verified: true,
        paid: false,
        processing: true,
        status: "authorized",
        order_id: orderId,
        payment_id: authorizedPayment.id,
        amount: Number(authorizedPayment.amount || 0),
        currency: authorizedPayment.currency || expectedCurrency
      });

    }


    /*
      A newly-created payment can exist briefly while
      the UPI app/payment provider is still processing it.
    */
    const createdPayment = payments
      .filter(payment =>
        payment &&
        payment.status === "created"
      )
      .sort(
        (a, b) =>
          Number(b.created_at || 0) -
          Number(a.created_at || 0)
      )[0];


    if (createdPayment) {

      return res.status(200).json({
        success: true,
        verified: true,
        paid: false,
        processing: true,
        status: "created",
        order_id: orderId,
        payment_id: createdPayment.id,
        amount: Number(createdPayment.amount || 0),
        currency: createdPayment.currency || expectedCurrency
      });

    }


    /*
      If all attempts failed, report failed.
      Otherwise there is simply no completed payment yet.
    */
    const failedPayment = payments
      .filter(payment =>
        payment &&
        payment.status === "failed"
      )
      .sort(
        (a, b) =>
          Number(b.created_at || 0) -
          Number(a.created_at || 0)
      )[0];


    if (failedPayment) {

      return res.status(200).json({
        success: true,
        verified: true,
        paid: false,
        processing: false,
        status: "failed",
        order_id: orderId,
        payment_id: failedPayment.id,
        error_code: failedPayment.error_code || null,
        error_description:
          failedPayment.error_description || null
      });

    }


    return res.status(200).json({
      success: true,
      verified: true,
      paid: false,
      processing: false,
      status: "pending",
      order_id: orderId,
      order_status: order.status || "created",
      amount: expectedAmount,
      currency: expectedCurrency
    });


  } catch (error) {

    const statusCode =
      Number(error?.statusCode) === 404
        ? 404
        : 500;

    console.error(
      "Order payment status check failed:",
      error?.error || error
    );


    return res.status(statusCode).json({
      success: false,
      paid: false,
      processing: false,
      message:
        statusCode === 404
          ? "Payment order not found"
          : error?.error?.description ||
            error?.message ||
            "Payment status checking failed"
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
