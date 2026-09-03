const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      WITH eligible AS (
        SELECT
          i.id AS investment_id,
          i.user_id,
          p.daily_return_amount AS amount,
          (
            now() AT TIME ZONE 'Africa/Johannesburg'
          )::date AS accrual_date
        FROM investments i
        JOIN investment_plans p
          ON p.id=i.plan_id
        WHERE i.status='active'
          AND i.started_at IS NOT NULL

          -- first payment only from the next SA calendar day
          AND (
            i.started_at
            AT TIME ZONE 'Africa/Johannesburg'
          )::date
          <
          (
            now()
            AT TIME ZONE 'Africa/Johannesburg'
          )::date

          AND (
            i.maturity_at IS NULL
            OR i.maturity_at > now()
          )

          AND p.daily_return_amount IS NOT NULL
          AND p.daily_return_amount > 0
      ),

      new_accruals AS (
        INSERT INTO investment_return_accruals
        (
          investment_id,
          user_id,
          accrual_date,
          amount
        )
        SELECT
          investment_id,
          user_id,
          accrual_date,
          amount
        FROM eligible

        ON CONFLICT (
          investment_id,
          accrual_date
        )
        DO NOTHING

        RETURNING
          investment_id,
          user_id,
          accrual_date,
          amount
      ),

      new_transactions AS (
        INSERT INTO transactions
        (
          user_id,
          reference,
          type,
          amount,
          currency,
          status,
          source,
          provider_reference,
          completed_at
        )
        SELECT
          user_id,

          'RET-' ||
          substring(
            replace(investment_id::text,'-',''),
            1,
            12
          ) ||
          '-' ||
          to_char(accrual_date,'YYYYMMDD'),

          'return',
          amount,
          'ZAR',
          'completed',
          'daily_return',

          'daily_return:' ||
          investment_id::text ||
          ':' ||
          accrual_date::text,

          now()

        FROM new_accruals

        RETURNING
          id,
          provider_reference
      )

      UPDATE investment_return_accruals a
      SET transaction_id=t.id
      FROM new_transactions t
      WHERE t.provider_reference =
        'daily_return:' ||
        a.investment_id::text ||
        ':' ||
        a.accrual_date::text

      RETURNING
        a.investment_id,
        a.accrual_date,
        a.amount
    `);

    await client.query("COMMIT");

    console.log(
      "DAILY RETURN CREDITS:",
      result.rowCount
    );

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
