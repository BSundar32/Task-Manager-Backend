const Brevo = require('@getbrevo/brevo');

// ─── Brevo API Client Setup ───────────────────────────────────────

let apiInstance = null;

const getApiInstance = () => {
  if (apiInstance) return apiInstance;
  apiInstance = new Brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(
    Brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
  );
  return apiInstance;
};

// ─── Verify at server startup ─────────────────────────────────────

const verifyEmailConnection = async () => {
  console.log('🔍 Verifying Brevo API configuration...');

  if (!process.env.BREVO_API_KEY) {
    console.warn('⚠️  BREVO_API_KEY not set in .env — email notifications disabled.');
    return false;
  }
  if (!process.env.BREVO_FROM) {
    console.warn('⚠️  BREVO_FROM not set in .env — email notifications disabled.');
    return false;
  }

  try {
    // Lightweight check: fetch account info to verify the API key is valid
    const accountApi = new Brevo.AccountApi();
    accountApi.setApiKey(Brevo.AccountApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    await accountApi.getAccount();
    console.log(`✅ Brevo API connected — sending from: ${process.env.BREVO_FROM}`);
    return true;
  } catch (err) {
    console.error(`❌ Brevo API error: ${err.message}`);
    console.error('   → Check BREVO_API_KEY in .env');
    console.error('   → Get API key: app.brevo.com → SMTP & API → API Keys tab → Create a new API key');
    apiInstance = null;
    return false;
  }
};

// ─── Core send function ───────────────────────────────────────────

const sendEmail = async ({ to, subject, html }) => {
  console.log(`\n📧 [Email attempt] "${subject}" → ${to}`);

  if (!process.env.BREVO_API_KEY || !process.env.BREVO_FROM) {
    console.warn('   ⚠️  Skipped — BREVO_API_KEY or BREVO_FROM not set in .env');
    return null;
  }

  try {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.sender   = { name: 'TaskManager', email: process.env.BREVO_FROM };
    sendSmtpEmail.to       = [{ email: to }];
    sendSmtpEmail.subject  = subject;
    sendSmtpEmail.htmlContent = html;

    const result = await getApiInstance().sendTransacEmail(sendSmtpEmail);
    console.log(`   ✅ Sent via Brevo! MessageId: ${result.body?.messageId || 'ok'}`);
    return result;
  } catch (err) {
    const msg = err.response?.body?.message || err.message;
    console.error(`   ❌ Brevo send failed: ${msg}`);
    if (err.status === 401) {
      console.error('   → API key invalid or expired. Regenerate at app.brevo.com → SMTP & API → API Keys');
      apiInstance = null;
    }
    return null;
  }
};

// ─── Email Templates ──────────────────────────────────────────────

const taskAssignedEmail = (user, task, assigner) => ({
  to: user.email,
  subject: `[TaskManager] You've been assigned: ${task.title}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <div style="background:#4f46e5;padding:24px;color:#fff;">
        <h1 style="margin:0;font-size:20px;">New Task Assigned</h1>
      </div>
      <div style="padding:24px;">
        <p>Hi <strong>${user.name}</strong>,</p>
        <p><strong>${assigner.name}</strong> has assigned you a new task:</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
          <h2 style="margin:0 0 8px;color:#1f2937;">${task.title}</h2>
          <p style="color:#6b7280;margin:0 0 8px;">${task.description || 'No description provided.'}</p>
          <table style="width:100%;font-size:14px;">
            <tr><td style="color:#6b7280;padding:4px 0;"><strong>Priority:</strong></td><td>${task.priority}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;"><strong>Category:</strong></td><td>${task.category}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;"><strong>Deadline:</strong></td><td>${new Date(task.deadline).toLocaleDateString()}</td></tr>
          </table>
        </div>
        <p style="color:#6b7280;font-size:13px;">Log in to TaskManager to view and manage this task.</p>
      </div>
    </div>
  `,
});

const deadlineReminderEmail = (user, task) => ({
  to: user.email,
  subject: `[TaskManager] Deadline approaching: ${task.title}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <div style="background:#f59e0b;padding:24px;color:#fff;">
        <h1 style="margin:0;font-size:20px;">Deadline Approaching</h1>
      </div>
      <div style="padding:24px;">
        <p>Hi <strong>${user.name}</strong>,</p>
        <p>The deadline for your task is approaching:</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
          <h2 style="margin:0 0 8px;color:#1f2937;">${task.title}</h2>
          <p style="color:#ef4444;font-weight:600;">Due: ${new Date(task.deadline).toLocaleDateString()}</p>
          <p style="color:#6b7280;margin:8px 0 0;">${task.description || ''}</p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Please update your task status or complete it before the deadline.</p>
      </div>
    </div>
  `,
});

const taskStatusChangedEmail = (user, task, oldStatus, newStatus, changedBy) => ({
  to: user.email,
  subject: `[TaskManager] Task status updated: ${task.title}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <div style="background:#10b981;padding:24px;color:#fff;">
        <h1 style="margin:0;font-size:20px;">Task Status Updated</h1>
      </div>
      <div style="padding:24px;">
        <p>Hi <strong>${user.name}</strong>,</p>
        <p><strong>${changedBy.name}</strong> updated the status of <strong>${task.title}</strong>:</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;"><span style="color:#6b7280;">From:</span> <strong>${oldStatus}</strong></p>
          <p style="margin:4px 0 0;"><span style="color:#6b7280;">To:</span> <strong style="color:#10b981;">${newStatus}</strong></p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Log in to TaskManager to view details.</p>
      </div>
    </div>
  `,
});

const commentAddedEmail = (user, task, comment, commenter) => ({
  to: user.email,
  subject: `[TaskManager] New comment on: ${task.title}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <div style="background:#6366f1;padding:24px;color:#fff;">
        <h1 style="margin:0;font-size:20px;">New Comment</h1>
      </div>
      <div style="padding:24px;">
        <p>Hi <strong>${user.name}</strong>,</p>
        <p><strong>${commenter.name}</strong> commented on <strong>${task.title}</strong>:</p>
        <div style="background:#fff;border-left:4px solid #6366f1;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;">
          <p style="margin:0;color:#1f2937;">${comment.content}</p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Log in to reply or view the full discussion.</p>
      </div>
    </div>
  `,
});

const taskUpdatedEmail = (user, task, changes, updatedBy) => {
  const fieldLabels = {
    title: 'Title', description: 'Description',
    deadline: 'Deadline', priority: 'Priority', category: 'Category',
  };
  const changeRows = changes.map(({ field, from, to }) => {
    const label   = fieldLabels[field] || field;
    const fromStr = field === 'deadline' ? new Date(from).toLocaleDateString() : String(from ?? '—');
    const toStr   = field === 'deadline' ? new Date(to).toLocaleDateString()   : String(to   ?? '—');
    return `
      <tr>
        <td style="padding:6px 0;color:#6b7280;font-size:13px;width:100px;">${label}</td>
        <td style="padding:6px 0;font-size:13px;">
          <span style="color:#ef4444;text-decoration:line-through;">${fromStr}</span>
          &nbsp;→&nbsp;
          <span style="color:#10b981;font-weight:600;">${toStr}</span>
        </td>
      </tr>`;
  }).join('');

  return {
    to: user.email,
    subject: `[TaskManager] Task updated: ${task.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
        <div style="background:#0ea5e9;padding:24px;color:#fff;">
          <h1 style="margin:0;font-size:20px;">Task Updated</h1>
        </div>
        <div style="padding:24px;">
          <p>Hi <strong>${user.name}</strong>,</p>
          <p><strong>${updatedBy.name}</strong> made changes to a task you're involved in:</p>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
            <h2 style="margin:0 0 12px;color:#1f2937;">${task.title}</h2>
            <table style="width:100%;">${changeRows}</table>
          </div>
          <p style="color:#6b7280;font-size:13px;">Log in to TaskManager to view the full task.</p>
        </div>
      </div>
    `,
  };
};

const taskSharedEmail = (user, task, sharedBy, permission) => ({
  to: user.email,
  subject: `[TaskManager] "${task.title}" has been shared with you`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <div style="background:#8b5cf6;padding:24px;color:#fff;">
        <h1 style="margin:0;font-size:20px;">Task Shared With You</h1>
      </div>
      <div style="padding:24px;">
        <p>Hi <strong>${user.name}</strong>,</p>
        <p><strong>${sharedBy.name}</strong> has shared a task with you:</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
          <h2 style="margin:0 0 8px;color:#1f2937;">${task.title}</h2>
          <p style="color:#6b7280;margin:0 0 12px;">${task.description || 'No description provided.'}</p>
          <table style="width:100%;font-size:14px;">
            <tr>
              <td style="color:#6b7280;padding:4px 0;width:100px;"><strong>Access:</strong></td>
              <td>
                <span style="background:${permission === 'edit' ? '#ede9fe' : '#f1f5f9'};color:${permission === 'edit' ? '#7c3aed' : '#475569'};padding:2px 10px;border-radius:999px;font-size:12px;">
                  ${permission === 'edit' ? 'Can Edit' : 'View Only'}
                </span>
              </td>
            </tr>
            <tr><td style="color:#6b7280;padding:4px 0;"><strong>Priority:</strong></td><td>${task.priority}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;"><strong>Deadline:</strong></td><td>${new Date(task.deadline).toLocaleDateString()}</td></tr>
          </table>
        </div>
        <p style="color:#6b7280;font-size:13px;">Log in to TaskManager to view this task.</p>
      </div>
    </div>
  `,
});

module.exports = {
  sendEmail,
  verifyEmailConnection,
  taskAssignedEmail,
  taskUpdatedEmail,
  taskSharedEmail,
  deadlineReminderEmail,
  taskStatusChangedEmail,
  commentAddedEmail,
};
