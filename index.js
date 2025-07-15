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
require("dotenv").config();

// Environment validation
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error("❌ Missing Razorpay credentials in environment variables");
  process.exit(1);
}

if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
  console.error("❌ Missing Razorpay webhook secret in environment variables");
  process.exit(1);
}

const app = express();
app.use(express.json());


// Enhanced middleware with better error handling
app.use(cors());

// Raw body parser for webhook
app.use('/webhook', express.raw({ type: 'application/json' }));
// JSON parser for other routes
app.use(express.json({ limit: '10mb' }));

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Enhanced order store with TTL
const orderStore = new Map();

// Enhanced Google Sheets saving with better error handling
const saveBookingToSheet = async (bookingData) => {
  try {
    console.log("📝 Saving booking to Google Sheets...");
    
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

    const sheetData = {
      booking_date: bookingData.date || '',
      booking_time: bookingData.lastItem
        ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
        : "Not Available",
      whatsapp_number: bookingData.whatsapp || '',
      num_people: bookingData.people || 0,
      decoration: bookingData.wantDecoration ? "Yes" : "No",
      advance_amount: bookingData.advanceAmount || 10,
      remaining_amount: bookingData.remainingAmount || 0,
      total_amount: bookingData.totalAmount || bookingData.amountWithTax || 0,
      payment_id: bookingData.paymentId || '',
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations.join(', ') 
        : bookingData.extraDecorations || '',
      address: bookingData.address || '',
      bookingName: bookingData.bookingName || '',
      slotType: bookingData.slotType || '',
      email: bookingData.email || '',
      payment_status: "Partial (Advance paid)",
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      PaymentMode: "Online",
      occasion: bookingData.occasion || '',
      processed_date: currentDate,
      processed_time: currentTime,
      processed_timestamp: isoTimestamp,
      order_id: bookingData.orderId || '',
      payment_link_id: bookingData.paymentLinkId || '',
      source: bookingData.source || 'web_app',
      created_at: bookingData.createdAt || isoTimestamp
    };

    console.log("📊 Sheet data prepared:", sheetData);

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      {
        data: [sheetData],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000, 
      }
    );

    console.log("✅ Google Sheets save successful");
    return response.data;
  } catch (error) {
    console.error("❌ Error saving to Google Sheets:", error.response?.data || error.message);
    throw error;
  }
};

// Enhanced Firebase saving with better error handling
const saveToFirebase = async (bookingData, paymentDetails) => {
  try {
    console.log("🔥 Saving booking to Firebase...");
    
    const saveData = {
      bookingName: bookingData.bookingName || '',
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      email: bookingData.email || '',
      address: bookingData.address || '',
      whatsapp: bookingData.whatsapp || '',
      date: bookingData.date || '',
      people: bookingData.people || 0,
      wantDecoration: bookingData.wantDecoration || false,
      occasion: bookingData.occasion || '',
      extraDecorations: bookingData.extraDecorations || [],
      selectedTimeSlot: bookingData.lastItem || bookingData.cartData?.[0] || null,
      lastItem: bookingData.lastItem || bookingData.cartData?.[0] || null,
      cartData: bookingData.cartData || [],
      slotType: bookingData.slotType || '',
      status: "booked",
      paymentId: paymentDetails.razorpay_payment_id || '',
      orderId: paymentDetails.razorpay_order_id || '',
      paymentLinkId: paymentDetails.payment_link_id || '',
      paymentStatus: "partial",
      advancePaid: bookingData.advanceAmount || 10,
      remainingAmount: bookingData.remainingAmount || 0,
      totalAmount: bookingData.totalAmount || bookingData.amountWithTax || 0,
      timestamp: new Date(),
      createdAt: new Date(),
      source: bookingData.source || 'web_app',
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "2.0",
        paymentMethod: "razorpay_payment_link",
        webhookProcessed: true
      },
    };

    console.log("📊 Firebase data prepared:", saveData);

    const collectionName = bookingData.slotType || 'bookings';
    const docRef = await addDoc(collection(db, collectionName), saveData);
    
    console.log("✅ Firebase save successful with ID:", docRef.id);
    return { ...saveData, id: docRef.id };
  } catch (error) {
    console.error("❌ Error saving to Firebase:", error);
    throw error;
  }
};

// Enhanced phone number validation
const validateAndSanitizePhone = (phone) => {
  if (!phone) return "";
  
  const cleanPhone = phone.toString().replace(/\D/g, '');
  const hasRecurringDigits = /^(\d)\1{9,}$/.test(cleanPhone);
  
  if (cleanPhone.length < 10 || cleanPhone.length > 12 || hasRecurringDigits) {
    console.log(`⚠️ Invalid phone number: ${cleanPhone}`);
    return "";
  }
  
  return cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone;
};

// Enhanced payment link creation
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    
    if (!bookingData || !amount) {
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    console.log("🔗 Creating payment link for booking:", bookingData.bookingName);

    const sanitizedPhone = validateAndSanitizePhone(bookingData.whatsapp);
    const referenceId = "booking_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    
    const options = {
      amount: amount * 100, // Convert to paise
      currency: "INR",
      reference_id: referenceId,
      description: `Theater Booking - ${bookingData.bookingName || 'Customer'}`,
      customer: {
        name: bookingData.bookingName || "Customer",
        email: bookingData.email || "",
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      callback_url: `${process.env.FRONTEND_URL || 'https://birthday-backend-tau.vercel.app'}/payment-success`,
      callback_method: "get",
    };

    // Add phone only if valid
    if (sanitizedPhone) {
      options.customer.contact = sanitizedPhone;
    }

    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Store enhanced booking data
    const enhancedBookingData = {
      ...bookingData,
      totalAmount: bookingData.totalAmount || bookingData.amountWithTax,
      advanceAmount: amount,
      remainingAmount: (bookingData.totalAmount || bookingData.amountWithTax) - amount,
      source: 'web_app',
      createdAt: new Date().toISOString(),
      reference_id: referenceId
    };

    orderStore.set(paymentLink.id, {
      bookingData: enhancedBookingData,
      amount,
      status: "created",
      type: "payment_link",
      createdAt: new Date(),
      reference_id: referenceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    console.log(`✅ Payment link created: ${paymentLink.id}`);
    
    res.json({
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId: referenceId,
    });
  } catch (error) {
    console.error("❌ Payment link creation failed:", error);
    res.status(500).json({ 
      error: "Payment link creation failed",
      details: error.message 
    });
  }
});

// Enhanced webhook signature verification
const verifyWebhookSignature = (body, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch (error) {
    console.error("❌ Signature verification error:", error);
    return false;
  }
};

// Enhanced webhook handler
app.post("/webhook", async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log(`🔔 [${requestId}] Webhook received at ${new Date().toISOString()}`);
    
    if (!webhookSecret) {
      console.error(`❌ [${requestId}] Webhook secret not configured`);
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!webhookSignature) {
      console.error(`❌ [${requestId}] Missing webhook signature`);
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    // Verify webhook signature
    const isValidSignature = verifyWebhookSignature(
      req.body,
      webhookSignature,
      webhookSecret
    );

    if (!isValidSignature) {
      console.error(`❌ [${requestId}] Invalid webhook signature`);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body);
    console.log(`🔔 [${requestId}] Event: ${event.event}`);

    // Handle different event types
    switch (event.event) {
      case "payment_link.paid":
        await handlePaymentLinkPaid(event.payload.payment_link.entity, event.payload.payment.entity, requestId);
        break;
        
      case "payment.captured":
        await handlePaymentCaptured(event.payload.payment.entity, requestId);
        break;
        
      case "payment.failed":
        await handlePaymentFailed(event.payload.payment.entity, requestId);
        break;
        
      default:
        console.log(`ℹ️ [${requestId}] Ignored event: ${event.event}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ [${requestId}] Webhook processed in ${processingTime}ms`);
    
    res.json({ 
      status: "success", 
      processingTime: `${processingTime}ms`,
      requestId 
    });
  } catch (error) {
    console.error(`❌ [${requestId}] Webhook error:`, error);
    res.status(500).json({ 
      error: "Webhook processing failed", 
      message: error.message,
      requestId 
    });
  }
});

// Enhanced payment link handler
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkEntity.id}`);
    
    const orderDetails = orderStore.get(paymentLinkEntity.id);
    
    if (!orderDetails) {
      console.error(`❌ [${requestId}] Payment link data not found: ${paymentLinkEntity.id}`);
      console.log(`📋 [${requestId}] Available IDs:`, Array.from(orderStore.keys()));
      
      // Try to fetch payment details from Razorpay API as fallback
      try {
        console.log(`🔄 [${requestId}] Attempting to fetch payment link details from Razorpay...`);
        const paymentLinkDetails = await razorpay.paymentLink.fetch(paymentLinkEntity.id);
        
        if (paymentLinkDetails && paymentLinkDetails.notes) {
          console.log(`✅ [${requestId}] Recovered booking data from Razorpay notes`);
          const recoveredBookingData = JSON.parse(paymentLinkDetails.notes.bookingData || '{}');
          
          const bookingDataWithPayment = {
            ...recoveredBookingData,
            paymentId: paymentEntity.id,
            orderId: paymentEntity.order_id,
            paymentLinkId: paymentLinkEntity.id,
            advanceAmount: paymentLinkDetails.amount / 100,
            webhookProcessedAt: new Date().toISOString(),
            webhookRequestId: requestId,
            source: 'webhook_recovery'
          };

          const paymentDetails = {
            razorpay_payment_id: paymentEntity.id,
            razorpay_order_id: paymentEntity.order_id,
            payment_link_id: paymentLinkEntity.id,
          };

          // Save recovered data
          const [firebaseResult, sheetsResult] = await Promise.allSettled([
            saveToFirebase(bookingDataWithPayment, paymentDetails),
            saveBookingToSheet(bookingDataWithPayment)
          ]);

          console.log(`✅ [${requestId}] Recovery save completed - Firebase: ${firebaseResult.status}, Sheets: ${sheetsResult.status}`);
          return;
        }
      } catch (recoveryError) {
        console.error(`❌ [${requestId}] Recovery attempt failed:`, recoveryError.message);
      }
      
      return;
    }
    
    // Prevent duplicate processing
    if (orderDetails.status === "paid") {
      console.log(`⚠️ [${requestId}] Payment already processed: ${paymentLinkEntity.id}`);
      return;
    }

    console.log(`💰 [${requestId}] Processing payment: ${paymentEntity.id}`);
    
    // Prepare enhanced booking data
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentEntity.id,
      orderId: paymentEntity.order_id,
      paymentLinkId: paymentLinkEntity.id,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId
    };

    const paymentDetails = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkEntity.id,
    };

    console.log(`💾 [${requestId}] Saving data to Firebase and Sheets...`);

    // Save to both services with enhanced error handling
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Log detailed results
    const dataStored = {
      firebase: firebaseResult.status === 'fulfilled',
      sheets: sheetsResult.status === 'fulfilled',
      firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
      sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
      timestamp: new Date().toISOString()
    };

    console.log(`📊 [${requestId}] Data storage results:`, dataStored);

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentEntity = paymentEntity;
    orderDetails.dataStored = dataStored;
    orderDetails.savedBooking = firebaseResult.status === 'fulfilled' ? firebaseResult.value : null;
    orderDetails.processedAt = new Date().toISOString();
    orderDetails.webhookRequestId = requestId;
    orderStore.set(paymentLinkEntity.id, orderDetails);
    
    console.log(`✅ [${requestId}] Payment link processed successfully`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment link processing failed:`, error);
    
    // Update order with error status
    const orderDetails = orderStore.get(paymentLinkEntity.id);
    if (orderDetails) {
      orderDetails.status = "error";
      orderDetails.error = error.message;
      orderDetails.errorAt = new Date().toISOString();
      orderStore.set(paymentLinkEntity.id, orderDetails);
    }
  }
};

// Enhanced regular payment handler
const handlePaymentCaptured = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    const paymentId = paymentEntity.id;
    const orderDetails = orderStore.get(orderId);
    
    if (!orderDetails) {
      console.log(`⚠️ [${requestId}] Order data not found: ${orderId}`);
      return;
    }
    
    console.log(`💰 [${requestId}] Processing regular payment: ${paymentId}`);
    
    // Similar processing logic as payment link
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentId,
      orderId: orderId,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId
    };

    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: "webhook_verified",
    };

    // Save to both services
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentId = paymentId;
    orderDetails.dataStored = {
      firebase: firebaseResult.status === 'fulfilled',
      sheets: sheetsResult.status === 'fulfilled',
      firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
      sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
      timestamp: new Date().toISOString()
    };
    orderDetails.savedBooking = firebaseResult.status === 'fulfilled' ? firebaseResult.value : null;
    orderDetails.processedAt = new Date().toISOString();
    orderStore.set(orderId, orderDetails);

    console.log(`✅ [${requestId}] Regular payment processed: ${paymentId}`);
  } catch (error) {
    console.error(`❌ [${requestId}] Regular payment processing failed:`, error);
  }
};

// Enhanced payment failure handler
const handlePaymentFailed = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    console.log(`❌ [${requestId}] Payment failed:`, { orderId, paymentId: paymentEntity.id });

    const orderDetails = orderStore.get(orderId);
    if (orderDetails) {
      orderDetails.status = "failed";
      orderDetails.error = "Payment failed";
      orderDetails.failedAt = new Date().toISOString();
      orderStore.set(orderId, orderDetails);
    }
  } catch (error) {
    console.error(`❌ [${requestId}] Payment failure handling error:`, error);
  }
};

// Enhanced payment status endpoint
app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 Checking payment status: ${paymentId}`);
    
    // Check local store first
    const orderDetails = orderStore.get(paymentId);
    
    if (orderDetails) {
      console.log(`📊 Order details found:`, {
        status: orderDetails.status,
        type: orderDetails.type,
        dataStored: orderDetails.dataStored
      });
      
      if (orderDetails.status === "paid") {
        return res.json({
          status: "paid",
          bookingData: orderDetails.savedBooking,
          paymentDetails: orderDetails.paymentEntity,
          dataStored: orderDetails.dataStored,
          type: orderDetails.type || "order",
          processedAt: orderDetails.processedAt
        });
      }
    }
    
    // For payment links, check with Razorpay API
    if (paymentId.startsWith('plink_')) {
      try {
        console.log(`🔍 Checking payment link status with Razorpay API...`);
        const paymentLink = await razorpay.paymentLink.fetch(paymentId);
        
        if (paymentLink.status === "paid") {
          console.log(`✅ Payment link is paid but not processed locally`);
          return res.json({
            status: "paid",
            razorpayStatus: paymentLink.status,
            needsRecovery: !orderDetails,
            type: "payment_link",
          });
        } else {
          console.log(`⏳ Payment link status: ${paymentLink.status}`);
          return res.json({
            status: paymentLink.status,
            razorpayStatus: paymentLink.status,
            type: "payment_link",
          });
        }
      } catch (apiError) {
        console.error(`❌ Razorpay API error:`, apiError);
        return res.json({
          status: "unknown",
          error: "Could not verify payment status",
        });
      }
    }
    
    // For regular orders
    if (orderDetails) {
      res.json({
        status: orderDetails.status,
        bookingData: orderDetails.savedBooking,
        message: orderDetails.status === "failed" ? orderDetails.error : `Payment ${orderDetails.status}`,
        type: "order",
        dataStored: orderDetails.dataStored
      });
    } else {
      res.status(404).json({
        status: "not_found",
        message: "Order not found",
      });
    }
  } catch (error) {
    console.error("❌ Payment status check failed:", error);
    res.status(500).json({ error: "Status check failed", details: error.message });
  }
});

// Enhanced payment recovery endpoint
app.post("/recover-payment", async (req, res) => {
  try {
    const { paymentLinkId, bookingData } = req.body;
    
    if (!paymentLinkId) {
      return res.status(400).json({ error: "Payment link ID required" });
    }
    
    console.log(`🔄 Starting payment recovery for: ${paymentLinkId}`);
    
    // Check payment link status with Razorpay
    const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
    
    if (paymentLink.status === "paid") {
      // Get payments for this payment link
      const payments = await razorpay.payments.all({
        'payment_link_id': paymentLinkId
      });
      
      if (payments.items.length > 0) {
        const payment = payments.items[0];
        
        console.log(`🔄 Found payment to recover: ${payment.id}`);
        
        // Process the payment manually
        const bookingDataWithPayment = {
          ...bookingData,
          paymentId: payment.id,
          orderId: payment.order_id,
          paymentLinkId: paymentLinkId,
          advanceAmount: 10,
          remainingAmount: bookingData.totalAmount - 10,
          totalAmount: bookingData.totalAmount,
          recoveredAt: new Date().toISOString(),
          source: 'recovery_process'
        };

        const paymentDetails = {
          razorpay_payment_id: payment.id,
          razorpay_order_id: payment.order_id,
          payment_link_id: paymentLinkId,
        };

        // Save to both services
        const [firebaseResult, sheetsResult] = await Promise.allSettled([
          saveToFirebase(bookingDataWithPayment, paymentDetails),
          saveBookingToSheet(bookingDataWithPayment)
        ]);
        
        const dataStored = {
          firebase: firebaseResult.status === 'fulfilled',
          sheets: sheetsResult.status === 'fulfilled',
          firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
          sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Payment recovery completed:`, dataStored);
        
        res.json({
          status: "recovered",
          paymentId: payment.id,
          dataStored: dataStored
        });
      } else {
        console.log(`⚠️ No payments found for payment link: ${paymentLinkId}`);
        res.json({ status: "no_payment_found" });
      }
    } else {
      console.log(`⚠️ Payment link not paid: ${paymentLink.status}`);
      res.json({ 
        status: "not_paid",
        paymentLinkStatus: paymentLink.status 
      });
    }
  } catch (error) {
    console.error("❌ Payment recovery failed:", error);
    res.status(500).json({ 
      error: "Recovery failed", 
      details: error.message 
    });
  }
});

// Enhanced cleanup with TTL
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;

  for (const [id, orderDetails] of orderStore.entries()) {
    const shouldClean = orderDetails.expiresAt && now > orderDetails.expiresAt;
    
    if (shouldClean) {
      orderStore.delete(id);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired orders`);
  }
}, 60 * 60 * 1000); // Run every hour

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size,
    version: "2.0 - Enhanced Payment Links",
    environment: process.env.NODE_ENV || 'development'
  });
});

// Debug endpoint for development
if (process.env.NODE_ENV === 'development') {
  app.get("/debug/orders", (req, res) => {
    const orders = Array.from(orderStore.entries()).map(([id, order]) => ({
      id,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      dataStored: order.dataStored
    }));
    
    res.json({ orders, count: orders.length });
  });
}

const PORT = process.env.PORT || 3001 ;
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Server running on port ${PORT}`);
  console.log(`📡 Payment Links API Ready`);
  console.log(`🔗 Webhook endpoint: /webhook`);
  console.log(`🔄 Recovery endpoint: /recover-payment`);
  console.log(`📊 Health check: /health`);
});
