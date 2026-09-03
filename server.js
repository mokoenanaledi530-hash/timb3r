const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

const secret =
  process.env.JWT_SECRET ||
  "development-only-secret";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://localhost:5432/timb3r"
});

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use((req, res, next) => {
  console.log(
    "REQUEST:",
    req.method,
    req.originalUrl
  );

  next();
});

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================
   REFERENCES
========================= */

const ref = () =>
  `T3-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;


/* =========================
   AUTHENTICATION
========================= */

const auth = async (
  req,
  res,
  next
) => {
  try {
    const header =
      req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error:
          "Authentication required"
      });
    }

    const token =
      header.slice(7);

    req.user = jwt.verify(
      token,
      secret
    );

    next();
  } catch (err) {
    return res.status(401).json({
      error:
        "Authentication required"
    });
  }
};


/* =========================
   ROLE MIDDLEWARE
========================= */

const role =
  (...roles) =>
  (req, res, next) => {
    if (
      !req.user ||
      !roles.includes(req.user.role)
    ) {
      return res.status(403).json({
        error:
          "Insufficient permissions"
      });
    }

    next();
  };


/* =========================
   AUDIT
========================= */

async function audit(
  actor,
  action,
  type,
  id,
  metadata = {}
) {
  if (!pool) {
    return;
  }

  await pool.query(
    `INSERT INTO audit_logs
      (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
     VALUES
      ($1,$2,$3,$4,$5)`,
    [
      actor,
      action,
      type,
      id,
      metadata
    ]
  );
}


/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  async (req, res) => {
    let database =
      "not configured";

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        database =
          "connected";
      } catch (err) {
        database = "error";
      }
    }

    res.json({
      app: "TIMB3R",
      version: "0.2.0",
      status: "ok",
      database,
      mode:
        process.env.APP_MODE ||
        "demo"
    });
  }
);


/* =========================
   AUTH REGISTER
========================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error:
          "Database not configured"
      });
    }

    const {
      name,
      email,
      password,
      referralCode
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Name, email and 8+ character password required"
      });
    }

    try {
      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const code =
        crypto
          .randomBytes(5)
          .toString("hex")
          .toUpperCase();

      const result =
        await pool.query(
          `INSERT INTO users
            (
              name,
              email,
              password_hash,
              referral_code
            )
           VALUES
            ($1,$2,$3,$4)
           RETURNING
            id,
            name,
            email,
            role,
            kyc_status,
            referral_code`,
          [
            name.trim(),
            email
              .trim()
              .toLowerCase(),
            hash,
            code
          ]
        );

      await audit(
        result.rows[0].id,
        "REGISTER",
        "user",
        result.rows[0].id,
        {
          referralCode:
            referralCode ||
            null
        }
      );

      return res
        .status(201)
        .json({
          user:
            result.rows[0]
        });
    } catch (err) {
      console.error(
        "REGISTRATION ERROR:",
        err
      );

      return res
        .status(
          err.code ===
          "23505"
            ? 409
            : 500
        )
        .json({
          error:
            err.code ===
            "23505"
              ? "Email already registered"
              : "Registration failed"
        });
    }
  }
);


/* =========================
   AUTH LOGIN
========================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error:
          "Database not configured"
      });
    }

    const email =
      String(
        req.body.email || ""
      )
        .trim()
        .toLowerCase();

    const password =
      req.body.password || "";

    try {
      const result =
        await pool.query(
          "SELECT * FROM users WHERE email=$1",
          [email]
        );

      if (
        !result.rowCount ||
        !(await bcrypt.compare(
          password,
          result.rows[0]
            .password_hash
        ))
      ) {
        return res
          .status(401)
          .json({
            error:
              "Invalid credentials"
          });
      }

      const user =
        result.rows[0];

      const token =
        jwt.sign(
          {
            id: user.id,
            email: user.email,
            role: user.role
          },
          secret,
          {
            expiresIn: "2h"
          }
        );

      await audit(
        user.id,
        "LOGIN",
        "user",
        user.id
      );

      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          kyc_status:
            user.kyc_status
        }
      });
    } catch (err) {
      console.error(
        "LOGIN ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Login failed"
      });
    }
  }
);


/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  auth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             role,
             kyc_status,
             referral_code,
             created_at
           FROM users
           WHERE id=$1`,
          [req.user.id]
        );

      res.json(
        result.rows[0] ||
          null
      );
    } catch (err) {
      console.error(
        "ME ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load user"
      });
    }
  }
);


/* =========================
   PLANS
========================= */

app.get(
  "/api/plans",
  async (req, res) => {
    if (!pool) {
      return res.json([]);
    }

    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             description,
             min_amount,
             max_amount,
             term_days
           FROM investment_plans
           WHERE status='active'
           ORDER BY min_amount`
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "PLANS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load plans"
      });
    }
  }
);


/* =========================
   DASHBOARD
========================= */

app.get(
  "/api/dashboard",
  auth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT

            COALESCE(
              SUM(
                CASE
                  WHEN type='deposit'
                    AND status='completed'
                    THEN amount

                  WHEN type='return'
                    AND status='completed'
                    THEN amount

                  WHEN type='refund'
                    AND status='completed'
                    THEN amount

                  WHEN type='withdrawal'
                    AND status='completed'
                    THEN -amount

                  WHEN type='investment'
                    AND status='completed'
                    THEN -amount

                  ELSE 0
                END
              ),
              0
            ) AS available,

            COALESCE(
              SUM(
                CASE
                  WHEN type='investment'
                    AND status='completed'
                    THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS invested,

            COALESCE(
              SUM(
                CASE
                  WHEN type='return'
                    AND status='completed'
                    THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS returns

          FROM transactions
          WHERE user_id=$1
          `,
          [req.user.id]
        );

      res.json(
        result.rows[0]
      );
    } catch (err) {
      console.error(
        "DASHBOARD ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load dashboard"
      });
    }
  }
);


/* =========================
   USER TRANSACTIONS
========================= */

app.get(
  "/api/transactions",
  auth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             reference,
             type,
             amount,
             currency,
             status,
             created_at
           FROM transactions
           WHERE user_id=$1
           ORDER BY created_at DESC
           LIMIT 100`,
          [req.user.id]
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "TRANSACTIONS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load transactions"
      });
    }
  }
);


/* =========================
   USER INVESTMENTS
========================= */

app.get(
  "/api/investments",
  auth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             i.id,
             i.principal,
             i.status,
             i.started_at,
             i.maturity_at,
             p.name AS plan_name,
             p.term_days
           FROM investments i
           JOIN investment_plans p
             ON p.id=i.plan_id
           WHERE i.user_id=$1
           ORDER BY i.created_at DESC`,
          [req.user.id]
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "INVESTMENTS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load investments"
      });
    }
  }
);


/* =========================
   DEMO DEPOSIT
========================= */

app.post(
  "/api/deposits",
  auth,
  async (req, res) => {
    const amount =
      Number(req.body.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error:
          "Invalid amount"
      });
    }

    if (
      (process.env.APP_MODE ||
        "demo") !== "demo"
    ) {
      return res.status(501).json({
        error:
          "Live payment webhook integration is required"
      });
    }

    try {
      const reference =
        ref();

      await pool.query(
        `INSERT INTO transactions
          (
            user_id,
            reference,
            type,
            amount,
            status,
            source
          )
         VALUES
          (
            $1,
            $2,
            'deposit',
            $3,
            'completed',
            'demo'
          )`,
        [
          req.user.id,
          reference,
          amount
        ]
      );

      await audit(
        req.user.id,
        "CREATE_DEMO_DEPOSIT",
        "transaction",
        null,
        {
          reference,
          amount
        }
      );

      res.status(201).json({
        reference,
        status:
          "completed",
        message:
          "Demo only: no real funds moved."
      });
    } catch (err) {
      console.error(
        "DEMO DEPOSIT ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to create demo deposit"
      });
    }
  }
);


/* =========================
   INVESTMENTS
========================= */

app.post(
  "/api/investments",
  auth,
  async (req, res) => {
    const amount =
      Number(req.body.amount);

    const planId =
      req.body.planId;

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error:
          "Invalid amount"
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const planResult =
        await client.query(
          `SELECT *
           FROM investment_plans
           WHERE id=$1
             AND status='active'
           FOR SHARE`,
          [planId]
        );

      if (
        !planResult.rowCount
      ) {
        throw new Error(
          "Investment plan not found"
        );
      }

      const plan =
        planResult.rows[0];

      if (
        amount <
          Number(
            plan.min_amount
          ) ||
        amount >
          Number(
            plan.max_amount
          )
      ) {
        throw new Error(
          "Amount outside plan limits"
        );
      }

      const balanceResult =
        await client.query(
          `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN type='deposit'
                    AND status='completed'
                    THEN amount

                  WHEN type='return'
                    AND status='completed'
                    THEN amount

                  WHEN type='refund'
                    AND status='completed'
                    THEN amount

                  WHEN type='withdrawal'
                    AND status='completed'
                    THEN -amount

                  WHEN type='investment'
                    AND status='completed'
                    THEN -amount

                  ELSE 0
                END
              ),
              0
            ) AS available
          FROM transactions
          WHERE user_id=$1
          `,
          [req.user.id]
        );

      if (
        Number(
          balanceResult
            .rows[0]
            .available
        ) < amount
      ) {
        throw new Error(
          "Insufficient verified balance"
        );
      }

      const investmentResult =
        await client.query(
          `
          INSERT INTO investments
            (
              user_id,
              plan_id,
              principal,
              status,
              started_at,
              maturity_at
            )
          VALUES
            (
              $1,
              $2,
              $3,
              'active',
              now(),
              now()+($4||' days')::interval
            )
          RETURNING id
          `,
          [
            req.user.id,
            planId,
            amount,
            plan.term_days
          ]
        );

      const investmentReference =
        ref();

      await client.query(
        `INSERT INTO transactions
          (
            user_id,
            reference,
            type,
            amount,
            status,
            source
          )
         VALUES
          (
            $1,
            $2,
            'investment',
            $3,
            'completed',
            'internal'
          )`,
        [
          req.user.id,
          investmentReference,
          amount
        ]
      );

      await client.query(
        "COMMIT"
      );

      await audit(
        req.user.id,
        "CREATE_INVESTMENT",
        "investment",
        investmentResult
          .rows[0].id,
        {
          amount,
          planId,
          reference:
            investmentReference
        }
      );

      res.status(201).json({
        investmentId:
          investmentResult
            .rows[0].id,
        reference:
          investmentReference,
        status:
          "active"
      });
    } catch (err) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "INVESTMENT ERROR:",
        err
      );

      res.status(400).json({
        error:
          err.message ||
          "Investment failed"
      });
    } finally {
      client.release();
    }
  }
);


/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  auth,
  role(
    "admin",
    "compliance"
  ),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             role,
             kyc_status,
             created_at
           FROM users
           ORDER BY created_at DESC
           LIMIT 500`
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "ADMIN USERS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load users"
      });
    }
  }
);


/* =========================
   ADMIN TRANSACTIONS
========================= */

app.get(
  "/api/admin/transactions",
  auth,
  role(
    "admin",
    "compliance"
  ),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             t.reference,
             t.type,
             t.amount,
             t.status,
             t.created_at,
             u.email
           FROM transactions t
           JOIN users u
             ON u.id=t.user_id
           ORDER BY t.created_at DESC
           LIMIT 500`
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "ADMIN TRANSACTIONS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load transactions"
      });
    }
  }
);


/* =========================
   ADMIN AUDIT
========================= */

app.get(
  "/api/admin/audit",
  auth,
  role(
    "admin",
    "compliance"
  ),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             action,
             entity_type,
             entity_id,
             metadata,
             created_at
           FROM audit_logs
           ORDER BY created_at DESC
           LIMIT 500`
        );

      res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "ADMIN AUDIT ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load audit logs"
      });
    }
  }
);


/* =========================
   PAYMENT WEBHOOK
========================= */

app.post(
  "/api/webhooks/payment",
  async (req, res) => {
    if (
      (process.env.APP_MODE ||
        "demo") !== "live"
    ) {
      return res.status(202).json({
        received: true,
        mode: "demo"
      });
    }

    return res.status(501).json({
      error:
        "Configure and verify the payment provider webhook before enabling live money movement."
    });
  }
);


/* =========================
   BANK PAYMENT DETAILS
========================= */

app.get(
  "/api/payments/bank-details",
  auth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             referral_code
           FROM users
           WHERE id=$1`,
          [req.user.id]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          error:
            "User not found"
        });
      }

      const user =
        result.rows[0];

      const profileId =
        user.referral_code ||
        `T3-${user.id
          .slice(0, 8)
          .toUpperCase()}`;

      res.json({
        bank:
          process.env
            .NEDBANK_NAME ||
          "Nedbank",

        accountName:
          process.env
            .NEDBANK_ACCOUNT_NAME ||
          "Timber Investments",

        accountNumber:
          process.env
            .NEDBANK_ACCOUNT_NUMBER ||
          "",

        branchCode:
          process.env
            .NEDBANK_BRANCH_CODE ||
          "",

        reference:
          profileId,

        profileId
      });
    } catch (err) {
      console.error(
        "BANK DETAILS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to load payment details"
      });
    }
  }
);


/* =========================
   BANK PAYMENT SUBMISSION
========================= */

app.post(
  "/api/payments/bank",
  auth,
  async (req, res) => {
    try {
      const {
        amount,
        senderName,
        senderBank,
        paymentDate,
        proofUrl
      } = req.body;

      const numericAmount =
        Number(amount);

      if (
        !Number.isFinite(
          numericAmount
        ) ||
        numericAmount <= 0
      ) {
        return res.status(400).json({
          error:
            "Enter a valid payment amount"
        });
      }

      const userResult =
        await pool.query(
          `SELECT referral_code
           FROM users
           WHERE id=$1`,
          [req.user.id]
        );

      if (
        !userResult.rows.length
      ) {
        return res.status(404).json({
          error:
            "User not found"
        });
      }

      const profileReference =
        userResult.rows[0]
          .referral_code ||
        `T3-${req.user.id
          .slice(0, 8)
          .toUpperCase()}`;

      const result =
        await pool.query(
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
           VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )
           RETURNING
             id,
             amount,
             profile_reference,
             status,
             created_at`,
          [
            req.user.id,
            profileReference,
            numericAmount,
            senderName ||
              null,
            senderBank ||
              null,
            paymentDate ||
              null,
            proofUrl ||
              null
          ]
        );

      res.status(201).json({
        success: true,
        message:
          "Payment submitted for verification",
        payment:
          result.rows[0]
      });
    } catch (err) {
      console.error(
        "BANK PAYMENT SUBMISSION ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to submit payment"
      });
    }
  }
);


/* =========================
   ADMIN PAYMENTS
========================= */

app.get(
  "/api/admin/payments",
  auth,
  role("admin", "compliance"),
  async (req, res) => {
    try {
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
         JOIN users u ON u.id=bp.user_id
         ORDER BY bp.created_at DESC`
      );
      res.json({
        payments: result.rows
      });
    } catch (err) {
      console.error("ADMIN PAYMENT LIST ERROR:", err);
      res.status(500).json({
        error: "Unable to load payments"
      });
    }
  }
);


/* =========================
   ADMIN APPROVE BANK EFT
========================= */

app.post(
  "/api/admin/payments/:id/approve",
  auth,
  role("admin", "compliance"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /*
       * Lock the EFT while it is being reviewed.
       */
      const paymentResult = await client.query(
        `SELECT *
         FROM bank_payments
         WHERE id=$1
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

      /*
       * Do not approve an EFT twice.
       */
      if (payment.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          error: `Payment is already ${payment.status}`
        });
      }

      /*
       * Approve the bank EFT.
       *
       * The PostgreSQL trigger
       * credit_approved_bank_payment()
       * creates the single deposit transaction.
       */
      await client.query(
        `UPDATE bank_payments
         SET
           status='approved',
           reviewed_by=$1,
           reviewed_at=now(),
           admin_note=$2
         WHERE id=$3`,
        [
          req.user.id,
          req.body.note || "Bank EFT manually verified",
          req.params.id
        ]
      );

      /*
       * Find the transaction created by the trigger.
       */
      const transactionResult = await client.query(
        `SELECT
           id,
           reference,
           amount,
           currency,
           status
         FROM transactions
         WHERE reference=$1
         LIMIT 1`,
        [
          "BANK-" +
          payment.id.toString().replace(/-/g, "")
        ]
      );

      if (!transactionResult.rows.length) {
        throw new Error(
          "Payment approved but deposit transaction was not created"
        );
      }

      const transaction =
        transactionResult.rows[0];

      await client.query("COMMIT");

      /*
       * Audit successful approval.
       */
      try {
        await audit(
          req.user.id,
          "APPROVE_BANK_EFT",
          "bank_payment",
          payment.id,
          {
            amount: payment.amount,
            transaction_id: transaction.id,
            transaction_reference: transaction.reference
          }
        );
      } catch (auditError) {
        console.error(
          "AUDIT ERROR:",
          auditError
        );
      }

      return res.json({
        success: true,
        message: "Bank EFT approved and credited",
        paymentId: payment.id,
        transactionId: transaction.id,
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status
      });

    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "BANK EFT APPROVAL ERROR:",
        err
      );

      return res.status(500).json({
        error: "Unable to approve bank EFT"
      });

    } finally {
      client.release();
    }
  }
);

/* =========================
   ADMIN REJECT PAYMENT
========================= */

app.post(
  "/api/admin/payments/:id/reject",
  auth,
  role(
    "admin",
    "compliance"
  ),
  async (req, res) => {
    try {

      const result =
        await pool.query(
          `UPDATE bank_payments
           SET
             status='rejected',
             reviewed_by=$1,
             reviewed_at=now(),
             admin_note=$2
           WHERE id=$3
             AND status='pending'
           RETURNING
             id,
             status`,
          [
            req.user.id,
            req.body.note ||
              "Payment rejected",
            req.params.id
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          error:
            "Pending payment not found"
        });
      }

      try {
        await audit(
          req.user.id,
          "REJECT_PAYMENT",
          "bank_payment",
          req.params.id,
          {
            note:
              req.body.note ||
              "Payment rejected"
          }
        );
      } catch (auditError) {
        console.error(
          "AUDIT ERROR:",
          auditError
        );
      }

      res.json({
        success: true,
        message:
          "Payment rejected"
      });

    } catch (err) {

      console.error(
        "PAYMENT REJECTION ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Unable to reject payment"
      });
    }
  }
);



/* =========================
   TIMB3R FRONTEND PAGES
========================= */

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});


/* =========================
   FRONTEND CATCH-ALL
   MUST BE LAST
========================= */

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/* =========================
   START SERVER
========================= */

app.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `TIMB3R 0.2.0 listening on ${port}`
    );
  }
);
