const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc } = require("firebase/firestore");
const axios = require("axios");
const crypto = require("crypto");

const firebaseConfig = {
  apiKey: "AIzaSyBh48b4J2mL4d9cGy8TBFE_3qiZL5NMnMY",
  authDomain: "birthday-fad86.firebaseapp.com",
  projectId: "birthday-fad86",
  storageBucket: "birthday-fad86.firebasestorage.app",
  messagingSenderId: "263994407282",
  appId: "1:263994407282:web:255bb7cf12025dfb3d05eb",
  measurementId: "G-1MCR5CKGJ3",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Initialize Twilio
const twilioClient = new twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory storage for order details (use Redis in production)
const orderStore = new Map();

const saveBookingToSheet = async (bookingData) => {
  try {
    const now = new Date();
    const currentDate = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const currentTime = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const isoTimestamp = now.toISOString();

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      {
        data: [
          {
            booking_date: bookingData.date,
            booking_time: bookingData.lastItem
              ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
              : "Not Available",
            whatsapp_number: bookingData.whatsapp,
            num_people: bookingData.people,
            decoration: bookingData.wantDecoration ? "Yes" : "No",
            advance_amount: bookingData.advanceAmount,
            remaining_amount: bookingData.remainingAmount,
            total_amount: bookingData.amountWithTax,
            payment_id: bookingData.paymentId,
            extraDecorations: bookingData.extraDecorations,
            address: bookingData.address,
            bookingName: bookingData.bookingName,
            slotType: bookingData.slotType,
            email: bookingData.email,
            payment_status: "Partial (Advance paid)",
            NameUser: bookingData.NameUser,
            PaymentMode: "Online",
            occasion: bookingData.occasion,
            processed_date: currentDate,
            processed_time: currentTime,
            processed_timestamp: isoTimestamp,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error saving to sheet:", error);
    throw error;
  }
};

const sendWhatsAppReminder = async (params) => {
  try {
    const {
      to,
      date,
      time,
      bookingName,
      people,
      location,
      slotType,
      decorations,
      extraDecorations,
    } = params;

    const formattedNumber = to.startsWith("+") ? to.slice(1) : to;

    const message = `🎬 BOOKING CONFIRMATION 🎬

Hello ${bookingName || "there"}!

Your theater booking is confirmed!

📅 Date: ${date}
⏰ Time: ${time}
👥 Guests: ${people || "(not specified)"}
🏠 Venue: Mini Theater ${location || ""}
🎫 Slot Type: ${slotType || "Standard"}
${
  decorations
    ? `✨ *Decorations:* Yes${
        extraDecorations ? `\n   Details: ${extraDecorations}` : ""
      }`
    : ""
}

Please remember:
• Arrive 15 minutes early
• Bring your AADHAAR card for verification
• No smoking/drinking allowed inside
• Maintain cleanliness in the theater

For any questions, contact us at:
📞 +91-9764535650

Thank you for your booking! Enjoy your experience!`;

    const instanceId = "mcrtdre2eh";
    const authToken = "ajhunrv7ff0j7giapl9xuz9olt6uax";

    const response = await axios.post(
      `https://api.zaply.dev/v1/instance/${instanceId}/message/send`,
      {
        number: formattedNumber,
        message,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    console.log("WhatsApp reminder sent successfully!");
  } catch (error) {
    console.error("Error sending WhatsApp reminder:", error);
    throw error;
  }
};

const saveToFirebase = async (bookingData, paymentDetails) => {
  const saveData = {
    bookingName: bookingData.bookingName,
    NameUser: bookingData.NameUser,
    email: bookingData.email,
    address: bookingData.address,
    whatsapp: bookingData.whatsapp,
    date: bookingData.date,
    people: bookingData.people,
    wantDecoration: bookingData.wantDecoration,
    occasion: bookingData.occasion,
    extraDecorations: bookingData.extraDecorations || [],
    selectedTimeSlot: bookingData.lastItem || bookingData.cartData?.[0] || null,
    lastItem: bookingData.lastItem || bookingData.cartData?.[0] || null,
    cartData: bookingData.cartData || [],
    slotType: bookingData.slotType,
    status: "booked",
    paymentId: paymentDetails.razorpay_payment_id,
    orderId: paymentDetails.razorpay_order_id,
    paymentStatus: "partial",
    advancePaid: bookingData.advanceAmount,
    remainingAmount: bookingData.remainingAmount,
    totalAmount: bookingData.amountWithTax,
    timestamp: new Date(),
    createdAt: new Date(),
    bookingMeta: {
      createdAt: new Date(),
      source: "web",
      version: "1.0",
      paymentMethod: "razorpay",
    },
  };

  try {
    const collectionName = bookingData.slotType;
    const docRef = await addDoc(collection(db, collectionName), saveData);
    console.log("Booking saved successfully with ID:", docRef.id);

    return { ...saveData, id: docRef.id };
  } catch (error) {
    console.error("Error saving to Firebase:", error);
    throw error;
  }
};

// Verify Razorpay webhook signature
const verifyWebhookSignature = (body, signature, secret) => {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expectedSignature, "utf8")
  );
};

app.post("/create-order", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: {
        booking_id: Date.now().toString(),
        customer_name: bookingData?.bookingName || "N/A",
        customer_phone: bookingData?.whatsapp || "N/A",
      },
    };

    const order = await razorpay.orders.create(options);

    // Store order details for webhook processing
    orderStore.set(order.id, {
      bookingData: bookingData,
      amount: amount,
      status: "created",
      createdAt: new Date(),
    });

    res.json(order);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Razorpay Webhook endpoint
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const webhookSignature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("Webhook secret not configured");
        return res.status(400).json({ error: "Webhook secret not configured" });
      }

      // Verify webhook signature
      const isValidSignature = verifyWebhookSignature(
        req.body,
        webhookSignature,
        webhookSecret
      );

      if (!isValidSignature) {
        console.error("Invalid webhook signature");
        return res.status(400).json({ error: "Invalid signature" });
      }

      const event = JSON.parse(req.body);
      console.log("Webhook event received:", event.event);

      if (event.event === "payment.captured") {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        console.log("Payment captured:", { orderId, paymentId });

        // Get order details from store
        const orderDetails = orderStore.get(orderId);
        if (!orderDetails) {
          console.error("Order not found in store:", orderId);
          return res.status(404).json({ error: "Order not found" });
        }

        try {
          // Update order status
          orderDetails.status = "paid";
          orderDetails.paymentId = paymentId;
          orderStore.set(orderId, orderDetails);

          // Prepare booking data with payment info
          const bookingDataWithPayment = {
            ...orderDetails.bookingData,
            paymentId: paymentId,
            advanceAmount: orderDetails.amount,
            remainingAmount:
              orderDetails.bookingData.totalAmount - orderDetails.amount,
            amountWithTax: orderDetails.bookingData.totalAmount,
          };

          // Save booking to Firebase
          const savedBooking = await saveToFirebase(bookingDataWithPayment, {
            razorpay_payment_id: paymentId,
            razorpay_order_id: orderId,
            razorpay_signature: "webhook_verified",
          });

          // Save to Google Sheets
          await saveBookingToSheet(bookingDataWithPayment);

          // Send WhatsApp confirmation
          if (orderDetails.bookingData?.lastItem) {
            await sendWhatsAppReminder({
              to: `91${orderDetails.bookingData.whatsapp}`,
              date: orderDetails.bookingData.date,
              time: `${orderDetails.bookingData.lastItem.start} - ${orderDetails.bookingData.lastItem.end}`,
              bookingName:
                orderDetails.bookingData.bookingName ||
                orderDetails.bookingData.NameUser,
              people: orderDetails.bookingData.people,
              location: orderDetails.bookingData.location || "",
              slotType: orderDetails.bookingData.slotType,
              decorations: orderDetails.bookingData.wantDecoration,
              extraDecorations: orderDetails.bookingData.extraDecorations,
            });
          }

          // Store success data for status check
          orderDetails.savedBooking = savedBooking;
          orderStore.set(orderId, orderDetails);

          console.log("Booking processed successfully via webhook");
          res.json({ status: "success" });
        } catch (error) {
          console.error("Error processing payment webhook:", error);
          orderDetails.status = "failed";
          orderDetails.error = error.message;
          orderStore.set(orderId, orderDetails);
          res.status(500).json({ error: "Processing failed" });
        }
      } else if (event.event === "payment.failed") {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;

        console.log("Payment failed:", { orderId, paymentId: payment.id });

        const orderDetails = orderStore.get(orderId);
        if (orderDetails) {
          orderDetails.status = "failed";
          orderDetails.error = "Payment failed";
          orderStore.set(orderId, orderDetails);
        }

        res.json({ status: "failed" });
      } else {
        res.json({ status: "ignored" });
      }
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// Check payment status endpoint
app.get("/check-payment-status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderDetails = orderStore.get(orderId);

    if (!orderDetails) {
      return res.status(404).json({
        status: "not_found",
        message: "Order not found",
      });
    }

    switch (orderDetails.status) {
      case "paid":
        res.json({
          status: "success",
          bookingData: orderDetails.savedBooking,
          message: "Payment successful",
        });
        break;
      case "failed":
        res.json({
          status: "failed",
          message: orderDetails.error || "Payment failed",
        });
        break;
      case "created":
      default:
        res.json({
          status: "pending",
          message: "Payment pending",
        });
        break;
    }
  } catch (error) {
    console.error("Error checking payment status:", error);
    res.status(500).json({ error: "Status check failed" });
  }
});

// Legacy verify-payment endpoint for backward compatibility
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingData,
      advanceAmount,
      remainingAmount,
      amountWithTax,
    } = req.body;

    // This endpoint is now mainly for manual verification
    // Most processing should happen via webhook

    const orderDetails = orderStore.get(razorpay_order_id);
    if (orderDetails && orderDetails.status === "paid") {
      // Payment already processed via webhook
      res.json({
        status: "success",
        message: "Payment already processed",
        savedBooking: orderDetails.savedBooking,
      });
      return;
    }

    // Fallback processing if webhook failed
    const bookingDataWithPayment = {
      ...bookingData,
      paymentId: razorpay_payment_id,
      advanceAmount,
      remainingAmount,
      amountWithTax,
    };

    const savedBooking = await saveToFirebase(bookingDataWithPayment, {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    });

    await saveBookingToSheet(bookingDataWithPayment);

    res.json({
      status: "success",
      message: "Payment verified successfully",
      savedBooking,
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

// Cleanup old orders (run periodically)
setInterval(() => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

  for (const [orderId, orderDetails] of orderStore.entries()) {
    if (orderDetails.createdAt < cutoff) {
      orderStore.delete(orderId);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// New endpoint to send WhatsApp messages
app.post("/send-whatsapp", async (req, res) => {
  try {
    const { to, date, time } = req.body;

    if (!to || !date || !time) {
      return res.status(400).json({
        error:
          "Missing required parameters. Please provide to, date, and time.",
      });
    }

    const recipient = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const message = await twilioClient.messages.create({
      from: `${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: recipient,
      body: `Your birthday celebration booking is confirmed for ${date} at ${time}. We're excited to host you! If you need to make any changes, please contact us.`,
    });

    res.json({
      success: true,
      messageId: message.sid,
      status: message.status,
    });
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    res.status(500).json({
      error: "Failed to send WhatsApp message",
      details: error.message,
    });
  }
});

// Send reminder messages
app.post("/send-reminder", async (req, res) => {
  try {
    const { to, date, time } = req.body;

    if (!to || !date || !time) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const recipient = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const message = await twilioClient.messages.create({
      from: `${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: recipient,
      body: `Reminder: Your birthday celebration is tomorrow, ${date} at ${time}. We're looking forward to seeing you!`,
    });

    res.json({
      success: true,
      messageId: message.sid,
      status: message.status,
    });
  } catch (error) {
    console.error("Error sending reminder:", error);
    res.status(500).json({
      error: "Failed to send reminder",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
