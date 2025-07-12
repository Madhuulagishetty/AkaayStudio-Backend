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

// Enhanced CORS configuration for mobile browsers and payment callbacks
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:5173',
    'http://localhost:5174', // Added your current frontend port
    'https://yourdomain.com', 
    'https://your-netlify-domain.netlify.app',
    'https://birthday-backend-tau.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Additional headers for mobile compatibility and payment callbacks
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  
  // Add security headers for payment callbacks
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
});

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

// Enhanced in-memory storage for order details
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

// Enhanced mobile payment callback endpoint - CRITICAL FOR IPHONE FIX
app.get('/payment-callback', (req, res) => {
  console.log('Payment callback received:', req.query);
  
  // Extract payment details from query parameters
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, error } = req.query;
  
  // Get the frontend URL from environment or use default
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
  
  if (error) {
    // Payment failed - redirect to packages with error
    const errorUrl = `${frontendUrl}/packages?error=payment_failed&message=${encodeURIComponent(error)}`;
    return res.redirect(errorUrl);
  }
  
  if (razorpay_payment_id && razorpay_order_id) {
    // Payment successful - redirect to payment callback page
    const successUrl = `${frontendUrl}/payment-callback?payment_id=${razorpay_payment_id}&order_id=${razorpay_order_id}`;
    
    // Enhanced mobile-friendly redirect page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <title>Payment Successful</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container { 
            max-width: 400px; 
            width: 100%;
            background: white; 
            color: #333; 
            padding: 40px 30px; 
            border-radius: 20px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            text-align: center;
          }
          .success-icon { 
            font-size: 80px; 
            margin-bottom: 20px;
            animation: bounce 1s ease-in-out infinite alternate;
          }
          .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
            color: #4CAF50;
          }
          .message {
            font-size: 16px;
            color: #666;
            margin-bottom: 30px;
            line-height: 1.5;
          }
          .loading { 
            margin: 20px 0; 
          }
          .spinner { 
            border: 4px solid #f3f3f3; 
            border-top: 4px solid #4CAF50; 
            border-radius: 50%; 
            width: 40px; 
            height: 40px; 
            animation: spin 1s linear infinite; 
            margin: 0 auto 15px; 
          }
          .redirect-btn {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: background 0.3s;
          }
          .redirect-btn:hover {
            background: #45a049;
          }
          @keyframes spin { 
            0% { transform: rotate(0deg); } 
            100% { transform: rotate(360deg); } 
          }
          @keyframes bounce {
            0% { transform: translateY(0); }
            100% { transform: translateY(-10px); }
          }
          .payment-details {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h2 class="title">Payment Successful!</h2>
          <p class="message">Your booking has been confirmed successfully.</p>
          
          <div class="payment-details">
            <strong>Payment ID:</strong> ${razorpay_payment_id}<br>
            <strong>Order ID:</strong> ${razorpay_order_id}
          </div>
          
          <div class="loading">
            <div class="spinner"></div>
            <p>Redirecting you back to the app...</p>
          </div>
          
          <a href="${successUrl}" class="redirect-btn" id="manualRedirect" style="display: none;">
            Continue to App
          </a>
        </div>
        
        <script>
          // Enhanced redirect logic for better mobile compatibility
          function redirectToApp() {
            const redirectUrl = '${successUrl}';
            
            try {
              // Method 1: Direct redirect (works for most cases)
              window.location.href = redirectUrl;
              
              // Method 2: Fallback for iOS Safari
              setTimeout(() => {
                if (window.location.href.indexOf('payment-callback') !== -1) {
                  window.location.replace(redirectUrl);
                }
              }, 1500);
              
              // Method 3: For stubborn browsers
              setTimeout(() => {
                if (window.location.href.indexOf('payment-callback') !== -1) {
                  window.top.location.href = redirectUrl;
                }
              }, 3000);
              
              // Method 4: Show manual redirect button as last resort
              setTimeout(() => {
                if (window.location.href.indexOf('payment-callback') !== -1) {
                  document.querySelector('.loading').style.display = 'none';
                  document.getElementById('manualRedirect').style.display = 'inline-block';
                }
              }, 5000);
              
            } catch (error) {
              console.error('Redirect error:', error);
              // Show manual redirect immediately on error
              document.querySelector('.loading').style.display = 'none';
              document.getElementById('manualRedirect').style.display = 'inline-block';
            }
          }
          
          // Start redirect process
          document.addEventListener('DOMContentLoaded', redirectToApp);
          
          // Also try on window load for additional safety
          window.addEventListener('load', redirectToApp);
          
          // Handle back button to prevent users from getting stuck
          window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
              redirectToApp();
            }
          });
        </script>
      </body>
      </html>
    `);
  } else {
    // Invalid parameters
    const errorUrl = `${frontendUrl}/packages?error=invalid_payment`;
    res.redirect(errorUrl);
  }
});

// Enhanced payment success handler for mobile browsers
app.post('/payment-success', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    
    // Verify payment signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");
    
    const isAuthentic = expectedSignature === razorpay_signature;
    
    if (isAuthentic) {
      // Get order details
      const orderDetails = orderStore.get(razorpay_order_id);
      
      if (orderDetails) {
        // Process the booking
        const bookingDataWithPayment = {
          ...orderDetails.bookingData,
          paymentId: razorpay_payment_id,
          advanceAmount: orderDetails.amount,
          remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
          amountWithTax: orderDetails.bookingData.totalAmount,
        };

        const savedBooking = await saveToFirebase(bookingDataWithPayment, {
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
        });

        await saveBookingToSheet(bookingDataWithPayment);

        // Send WhatsApp confirmation
        if (orderDetails.bookingData?.lastItem) {
          await sendWhatsAppReminder({
            to: `91${orderDetails.bookingData.whatsapp}`,
            date: orderDetails.bookingData.date,
            time: `${orderDetails.bookingData.lastItem.start} - ${orderDetails.bookingData.lastItem.end}`,
            bookingName: orderDetails.bookingData.bookingName || orderDetails.bookingData.NameUser,
            people: orderDetails.bookingData.people,
            location: orderDetails.bookingData.location || "",
            slotType: orderDetails.bookingData.slotType,
            decorations: orderDetails.bookingData.wantDecoration,
            extraDecorations: orderDetails.bookingData.extraDecorations,
          });
        }

        // Update order status
        orderDetails.status = "paid";
        orderDetails.savedBooking = savedBooking;
        orderStore.set(razorpay_order_id, orderDetails);

        res.json({ 
          status: "success", 
          message: "Payment verified successfully",
          savedBooking,
          redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5174'}/thank-you?payment_id=${razorpay_payment_id}&order_id=${razorpay_order_id}`
        });
      } else {
        res.status(404).json({ error: "Order not found" });
      }
    } else {
      res.status(400).json({ error: "Invalid payment signature" });
    }
  } catch (error) {
    console.error("Payment success error:", error);
    res.status(500).json({ error: "Payment processing failed" });
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    
    // Get the current domain for callback URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const callbackUrl = `${protocol}://${host}/payment-callback`;
    
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: {
        booking_id: Date.now().toString(),
        customer_name: bookingData?.bookingName || "N/A",
        customer_phone: bookingData?.whatsapp || "N/A",
        package_type: bookingData?.slotType || "N/A",
      },
      // Enhanced callback configuration for mobile payments
      callback_url: callbackUrl,
      callback_method: "get"
    };

    const order = await razorpay.orders.create(options);

    // Store order details for webhook processing
    orderStore.set(order.id, {
      bookingData: bookingData,
      amount: amount,
      status: "created",
      createdAt: new Date(),
      callbackUrl: callbackUrl,
    });

    console.log(`Order created: ${order.id} for amount: ₹${amount}`);

    // Return order with enhanced mobile configuration
    res.json({
      ...order,
      callback_url: callbackUrl,
      key_id: process.env.RAZORPAY_KEY_ID, // Include key for frontend
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Something went wrong creating order" });
  }
});

// Enhanced webhook endpoint with better error handling
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

// Enhanced payment status check with mobile support
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';

    switch (orderDetails.status) {
      case "paid":
        res.json({
          status: "success",
          bookingData: orderDetails.savedBooking,
          message: "Payment successful",
          redirect_url: `${frontendUrl}/thank-you?payment_id=${orderDetails.paymentId}&order_id=${orderId}`,
        });
        break;
      case "failed":
        res.json({
          status: "failed",
          message: orderDetails.error || "Payment failed",
          redirect_url: `${frontendUrl}/packages?error=payment_failed`,
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

// Enhanced verify-payment endpoint with better mobile handling
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

    console.log("Verifying payment:", { razorpay_order_id, razorpay_payment_id });

    // Check if payment already processed via webhook
    const orderDetails = orderStore.get(razorpay_order_id);
    if (orderDetails && orderDetails.status === "paid") {
      console.log("Payment already processed via webhook");
      return res.json({
        status: "success",
        message: "Payment already processed",
        savedBooking: orderDetails.savedBooking,
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      console.error("Invalid payment signature");
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    // Process payment as fallback
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

    // Send WhatsApp confirmation
    if (bookingData?.lastItem) {
      await sendWhatsAppReminder({
        to: `91${bookingData.whatsapp}`,
        date: bookingData.date,
        time: `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`,
        bookingName: bookingData.bookingName || bookingData.NameUser,
        people: bookingData.people,
        location: bookingData.location || "",
        slotType: bookingData.slotType,
        decorations: bookingData.wantDecoration,
        extraDecorations: bookingData.extraDecorations,
      });
    }

    // Update order store
    if (orderDetails) {
      orderDetails.status = "paid";
      orderDetails.savedBooking = savedBooking;
      orderStore.set(razorpay_order_id, orderDetails);
    }

    console.log("Payment verified successfully");
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
    if (orderDetails.createdAt < cutoff && orderDetails.status !== "paid") {
      console.log(`Cleaning up old order: ${orderId}`);
      orderStore.delete(orderId);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// WhatsApp messaging endpoints
app.post("/send-whatsapp", async (req, res) => {
  try {
    const { to, date, time } = req.body;

    if (!to || !date || !time) {
      return res.status(400).json({
        error: "Missing required parameters. Please provide to, date, and time.",
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    orders_in_memory: orderStore.size,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📱 Payment callback URL: ${process.env.NODE_ENV === 'production' ? 'https://birthday-backend-tau.vercel.app' : `http://localhost:${PORT}`}/payment-callback`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});