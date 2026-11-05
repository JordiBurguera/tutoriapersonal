import nodemailer from 'nodemailer';

// Devuelve una función sendMail({ to, subject, text }). Sin credenciales SMTP imprime el
// correo en la consola para poder probar la aplicación en local.
export function createMailer(env = process.env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP sin configurar: los correos se imprimen en la consola.');
    return async ({ to, subject, text }) => console.log(`\n--- Correo para ${to}: ${subject}\n${text}\n---\n`);
  }
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  const from = env.SMTP_FROM || env.SMTP_USER;
  return ({ to, subject, text }) => transport.sendMail({ from, to, subject, text });
}
