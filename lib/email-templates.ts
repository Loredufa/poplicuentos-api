export function getResetPasswordEmail(code: string) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Restablecer Contraseña</title>
    <style>
        body { font-family: sans-serif; background-color: #f4f4f4; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .code { font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #333; text-align: center; margin: 20px 0; }
        .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Restablecer Contraseña</h2>
        <p>Hola,</p>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Popli.</p>
        <p>Usa el siguiente código para continuar:</p>
        <div class="code">${code}</div>
        <p>Este código es válido por 15 minutos.</p>
        <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Popli. Todos los derechos reservados.
        </div>
    </div>
</body>
</html>
  `;
}

export function getPasswordChangedEmail() {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contraseña Cambiada</title>
    <style>
        body { font-family: sans-serif; background-color: #f4f4f4; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Contraseña Actualizada</h2>
        <p>Hola,</p>
        <p>Te informamos que la contraseña de tu cuenta en Popli ha sido cambiada exitosamente.</p>
        <p>Si no realizaste este cambio, por favor contacta a soporte inmediatamente.</p>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Popli. Todos los derechos reservados.
        </div>
    </div>
</body>
</html>
  `;
}
