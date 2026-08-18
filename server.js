const express=require("express");
const helmet=require("helmet");
const bcrypt=require("bcrypt");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");
const path=require("path");
const crypto=require("crypto");

const app=express(), port=process.env.PORT||3000;
const secret=process.env.JWT_SECRET||"development-only-secret";
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false}):null;

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"1mb"}));
app.use((req,res,next)=>{
  console.log("REQUEST:", req.method, req.originalUrl);
  next();
});
app.use(express.static(path.join(__dirname,"public")));

const ref=()=>`T3-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const auth=async(req,res,next)=>{
 try{req.user=jwt.verify((req.headers.authorization||"").replace(/^Bearer\s+/i,""),secret);next()}
 catch{res.status(401).json({error:"Authentication required"})}
};
const role=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:"Insufficient permissions"});
async function audit(actor,action,type,id,metadata={}){
 if(pool) await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)",[actor,action,type,id,metadata]);
}

app.get("/api/health",async(req,res)=>{
 let database="not configured"; if(pool){try{await pool.query("SELECT 1");database="connected"}catch{database="error"}}
 res.json({app:"TIMB3R",version:"0.2.0",status:"ok",database,mode:process.env.APP_MODE||"demo"});
});
app.post("/api/auth/register", async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: "Database not configured"
    });
  }

  const { name, email, password, referralCode } = req.body;

  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({
      error: "Name, email and 8+ character password required"
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const code = crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase();

    const r = await pool.query(
      `INSERT INTO users
        (name, email, password_hash, referral_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, kyc_status, referral_code`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        hash,
        code
      ]
    );

    await audit(
      r.rows[0].id,
      "REGISTER",
      "user",
      r.rows[0].id,
      {
        referralCode: referralCode || null
      }
    );

    return res.status(201).json({
      user: r.rows[0]
    });

  } catch (e) {
    console.error("REGISTRATION ERROR:", e);
    console.error("REGISTRATION ERROR CODE:", e.code);
    console.error("REGISTRATION ERROR MESSAGE:", e.message);
    console.error("REGISTRATION ERROR DETAIL:", e.detail);
    console.error("REGISTRATION ERROR HINT:", e.hint);

    return res.status(e.code === "23505" ? 409 : 500).json({
      error:
        e.code === "23505"
          ? "Email already registered"
          : "Registration failed"
    });
  }
});


app.post("/api/auth/login",async(req,res)=>{
 if(!pool)return res.status(503).json({error:"Database not configured"});
 const r=await pool.query("SELECT * FROM users WHERE email=$1",[String(req.body.email||"").toLowerCase()]);
 if(!r.rowCount||!(await bcrypt.compare(req.body.password||"",r.rows[0].password_hash)))return res.status(401).json({error:"Invalid credentials"});
 const u=r.rows[0], token=jwt.sign({id:u.id,email:u.email,role:u.role},secret,{expiresIn:"2h"});
 await audit(u.id,"LOGIN","user",u.id);
 res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role,kyc_status:u.kyc_status}});
});

app.get("/api/me",auth,async(req,res)=>{
 const r=await pool.query("SELECT id,name,email,role,kyc_status,referral_code,created_at FROM users WHERE id=$1",[req.user.id]);
 res.json(r.rows[0]||null);
});

app.get("/api/plans",async(req,res)=>{
 if(!pool)return res.json([]);
 const r=await pool.query("SELECT id,name,description,min_amount,max_amount,term_days FROM investment_plans WHERE status='active' ORDER BY min_amount");
 res.json(r.rows);
});

app.get("/api/dashboard",auth,async(req,res)=>{
 const r=await pool.query(`
 SELECT
 COALESCE(SUM(CASE WHEN type='deposit' AND status='completed' THEN amount ELSE 0 END),0)-
 COALESCE(SUM(CASE WHEN type='withdrawal' AND status='completed' THEN amount ELSE 0 END),0) AS available,
 COALESCE(SUM(CASE WHEN type='investment' AND status='completed' THEN amount ELSE 0 END),0) AS invested,
 COALESCE(SUM(CASE WHEN type='return' AND status='completed' THEN amount ELSE 0 END),0) AS returns
 FROM transactions WHERE user_id=$1`,[req.user.id]);
 res.json(r.rows[0]);
});

app.get("/api/transactions",auth,async(req,res)=>{
 const r=await pool.query("SELECT reference,type,amount,currency,status,created_at FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.user.id]);
 res.json(r.rows);
});

app.get("/api/investments",auth,async(req,res)=>{
 const r=await pool.query(`SELECT i.id,i.principal,i.status,i.started_at,i.maturity_at,p.name plan_name,p.term_days
 FROM investments i JOIN investment_plans p ON p.id=i.plan_id WHERE i.user_id=$1 ORDER BY i.created_at DESC`,[req.user.id]);
 res.json(r.rows);
});

app.post("/api/deposits",auth,async(req,res)=>{
 const amount=Number(req.body.amount);
 if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Invalid amount"});
 if((process.env.APP_MODE||"demo")!=="demo")return res.status(501).json({error:"Live payment webhook integration is required"});
 const reference=ref();
 await pool.query("INSERT INTO transactions(user_id,reference,type,amount,status,source) VALUES($1,$2,'deposit',$3,'completed','demo')",[req.user.id,reference,amount]);
 await audit(req.user.id,"CREATE_DEMO_DEPOSIT","transaction",null,{reference,amount});
 res.status(201).json({reference,status:"completed",message:"Demo only: no real funds moved."});
});

app.post("/api/investments",auth,async(req,res)=>{
 const amount=Number(req.body.amount), planId=req.body.planId;
 if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Invalid amount"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const p=await c.query("SELECT * FROM investment_plans WHERE id=$1 AND status='active' FOR SHARE",[planId]);
  if(!p.rowCount||amount<p.rows[0].min_amount||amount>p.rows[0].max_amount)throw new Error("Amount outside plan limits");
  const bal=await c.query(`SELECT COALESCE(SUM(CASE WHEN type='deposit' AND status='completed' THEN amount WHEN type='return' AND status='completed' THEN amount WHEN type='refund' AND status='completed' THEN amount WHEN type='withdrawal' AND status='completed' THEN -amount WHEN type='investment' AND status='completed' THEN -amount ELSE 0 END),0) available FROM transactions WHERE user_id=$1`,[req.user.id]);
  if(Number(bal.rows[0].available)<amount)throw new Error("Insufficient verified balance");
  const inv=await c.query(`INSERT INTO investments(user_id,plan_id,principal,status,started_at,maturity_at)
  VALUES($1,$2,$3,'active',now(),now()+($4||' days')::interval) RETURNING id`,[req.user.id,planId,amount,p.rows[0].term_days]);
  await c.query("INSERT INTO transactions(user_id,reference,type,amount,status,source) VALUES($1,$2,'investment',$3,'completed','internal')",[req.user.id,ref(),amount]);
  await c.query("COMMIT"); await audit(req.user.id,"CREATE_INVESTMENT","investment",inv.rows[0].id,{amount,planId});
  res.status(201).json({investmentId:inv.rows[0].id,status:"active"});
 }catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message})}finally{c.release()}
});

app.get("/api/admin/users",auth,role("admin","compliance"),async(req,res)=>{
 const r=await pool.query("SELECT id,name,email,role,kyc_status,created_at FROM users ORDER BY created_at DESC LIMIT 500");res.json(r.rows);
});
app.get("/api/admin/transactions",auth,role("admin","compliance"),async(req,res)=>{
 const r=await pool.query(`SELECT t.reference,t.type,t.amount,t.status,t.created_at,u.email FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 500`);res.json(r.rows);
});
app.get("/api/admin/audit",auth,role("admin","compliance"),async(req,res)=>{
 const r=await pool.query("SELECT action,entity_type,entity_id,metadata,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 500");res.json(r.rows);
});
/* production payment webhook:
   Replace this demo route with the selected provider's signed webhook contract.
   It must verify signature, enforce idempotency on provider_reference,
   and only then mark the matching transaction completed.
*/

app.post("/api/webhooks/payment", async (req, res) => {
  if ((process.env.APP_MODE || "demo") !== "live") {
    return res.status(202).json({
      received: true,
      mode: "demo"
    });
  }

  return res.status(501).json({
    error:
      "Configure and verify the payment provider webhook before enabling live money movement."
  });
});

/* Frontend catch-all */
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(port, "0.0.0.0", () => {
  console.log(`TIMB3R 0.2.0 listening on ${port}`);
});

// ===============================
// TIMB3R BANK PAYMENT ROUTES
// ===============================

app.get("/api/payments/bank-details", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, referral_code
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const user = result.rows[0];

    // Use referral_code as the customer's payment reference.
    // If your system uses another Profile ID field, replace this.
    const profileId = user.referral_code || `T3-${user.id.slice(0, 8).toUpperCase()}`;

    res.json({
      bank: process.env.NEDBANK_NAME || "Nedbank",
      accountName: process.env.NEDBANK_ACCOUNT_NAME || "Timber Investments",
      accountNumber: process.env.NEDBANK_ACCOUNT_NUMBER || "",
      branchCode: process.env.NEDBANK_BRANCH_CODE || "",
      reference: profileId,
      profileId
    });

  } catch (err) {
    console.error("Bank details error:", err);

    res.status(500).json({
      error: "Unable to load payment details"
    });
  }
});


app.post("/api/payments/bank", auth, async (req, res) => {
  try {
    const {
      amount,
      senderName,
      senderBank,
      paymentDate,
      proofUrl
    } = req.body;

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        error: "Enter a valid payment amount"
      });
    }

    const userResult = await pool.query(
      `SELECT referral_code
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const profileReference =
      userResult.rows[0].referral_code ||
      `T3-${req.user.id.slice(0, 8).toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO bank_payments
       (
         user_id,
         profile_reference,
         amount,
         sender_name,
         sender_bank,
         payment_date,
         proof_url
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, amount, profile_reference, status, created_at`,
      [
        req.user.id,
        profileReference,
        numericAmount,
        senderName || null,
        senderBank || null,
        paymentDate || null,
        proofUrl || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Payment submitted for verification",
      payment: result.rows[0]
    });

  } catch (err) {
    console.error("Bank payment submission error:", err);

    res.status(500).json({
      error: "Unable to submit payment"
    });
  }
});


app.get("/api/admin/payments", auth, async (req, res) => {
  try {
    const adminResult = await pool.query(
      `SELECT role
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!adminResult.rows.length ||
        !["admin", "compliance"].includes(adminResult.rows[0].role)) {
      return res.status(403).json({
        error: "Administrator access required"
      });
    }

    const result = await pool.query(
      `SELECT
          bp.id,
          bp.profile_reference,
          bp.amount,
          bp.sender_name,
          bp.sender_bank,
          bp.payment_date,
          bp.proof_url,
          bp.status,
          bp.created_at,
          bp.reviewed_at,
          bp.admin_note,
          u.name AS customer_name,
          u.email AS customer_email
       FROM bank_payments bp
       JOIN users u ON u.id = bp.user_id
       ORDER BY bp.created_at DESC`
    );

    res.json({
      payments: result.rows
    });

  } catch (err) {
    console.error("Admin payment list error:", err);

    res.status(500).json({
      error: "Unable to load payments"
    });
  }
});


app.post("/api/admin/payments/:id/approve", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    const adminResult = await client.query(
      `SELECT role
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!adminResult.rows.length ||
        !["admin", "compliance"].includes(adminResult.rows[0].role)) {
      return res.status(403).json({
        error: "Administrator access required"
      });
    }

    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT *
       FROM bank_payments
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Payment not found"
      });
    }

    const payment = paymentResult.rows[0];

    if (payment.status !== "pending") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: `Payment is already ${payment.status}`
      });
    }

    await client.query(
      `UPDATE bank_payments
       SET
         status = 'approved',
         reviewed_by = $1,
         reviewed_at = now(),
         admin_note = $2
       WHERE id = $3`,
      [
        req.user.id,
        req.body.note || "Payment manually verified",
        req.params.id
      ]
    );

    /*
      IMPORTANT:
      Do not automatically add money to a user's balance here
      unless your investment/account-balance schema is already
      designed for this.

      Once your balance ledger is implemented, this transaction
      should create ONE immutable credit entry.
    */

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Payment approved"
    });

  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Payment approval error:", err);

    res.status(500).json({
      error: "Unable to approve payment"
    });

  } finally {
    client.release();
  }
});


app.post("/api/admin/payments/:id/reject", auth, async (req, res) => {
  try {
    const adminResult = await pool.query(
      `SELECT role
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!adminResult.rows.length ||
        !["admin", "compliance"].includes(adminResult.rows[0].role)) {
      return res.status(403).json({
        error: "Administrator access required"
      });
    }

    const result = await pool.query(
      `UPDATE bank_payments
       SET
         status = 'rejected',
         reviewed_by = $1,
         reviewed_at = now(),
         admin_note = $2
       WHERE id = $3
         AND status = 'pending'
       RETURNING id, status`,
      [
        req.user.id,
        req.body.note || "Payment rejected",
        req.params.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Pending payment not found"
      });
    }

    res.json({
      success: true,
      message: "Payment rejected"
    });

  } catch (err) {
    console.error("Payment rejection error:", err);

    res.status(500).json({
      error: "Unable to reject payment"
    });
  }
});