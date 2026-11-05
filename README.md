# Tutoría personal

Sustituye al Google Form de la elección de tutoría personal de Les Carolines. Prototipo funcional: frontend básico y backend sencillo. La interfaz está en valenciano.

## Puesta en marcha

Necesita Node 22.13 o superior.

```sh
npm install
cp .env.example .env   # define al menos ADMIN_USER
npm start              # http://localhost:3000
npm test
```

Sin `SMTP_USER` y `SMTP_PASS`, el enlace de acceso se imprime en la consola del servidor.

## Probar sin correos (temporal)

Con `LOGIN_PRUEBA=1` en `.env`, un usuario que contenga un número y `prof` (`prof1`), `alm` (`alm1`) o `admn` (`admn1`) entra sin correo de confirmación. Si no existía, se crea como profesor, alumno o administrador. Las demás cuentas de administrador siguen necesitando el correo.

Cualquiera podría entrar así, también como administrador: quita esa línea antes de abrir la aplicación a otras personas.

## Correo con Gmail

1. Activa la verificación en dos pasos en la cuenta que enviará los correos.
2. Crea una contraseña de aplicación en <https://myaccount.google.com/apppasswords>. En Google Workspace, el administrador del dominio debe tenerlas permitidas.
3. Pon la cuenta en `SMTP_USER` y la contraseña de aplicación en `SMTP_PASS`.
4. En producción, pon la URL pública con `https://` en `APP_URL`.

## Cómo funciona

- **Acceso:** se escribe solo el usuario y llega un enlace de confirmación a `usuario@lescarolines.com`. Quien no está dado de alta entra como alumnado.
- **Profesorado:** el administrador lo da de alta solo con el correo. En su primer acceso indica nombre, apellidos y departamento (lista `DEPARTMENTS` en `src/app.js`).
- **Elección:** el alumno ordena al profesorado manteniendo pulsado y arrastrando, y puede vetar hasta 2 (opcional). La solicitud va a su primera preferencia. Si el profesor la rechaza, pasa sola a la siguiente. Los vetados nunca la reciben.
- **Repetir tutor:** si un alumno pone primero al tutor que tuvo en la convocatoria anterior, queda confirmado directamente, sin que el profesor tenga que aceptarlo.
- **Cierre:** no se puede cerrar la elección mientras falte por votar alguien con cuenta. Administración puede asignarle tutor a mano o eliminar su cuenta para desbloquearlo.
- **Sin tutor:** administración asigna a mano a quien no contestó o fue rechazado por toda su lista.
- **Alumno a mitad de curso:** con la elección cerrada, administración crea la cuenta y asigna tutor sin confirmación.
- **Nueva convocatoria:** no cambia cursos ni cuentas. Las asignaciones anteriores dejan de estar vigentes, pero siguen guardadas en la base de datos. Cada alumno puede corregir su curso al votar.
- **Pas de curs:** con la elección cerrada, administración marca por clase quién no promociona y quién se da de baja, y confirma tras revisar la lista. El resto sube un curso y conserva grupo. Las bajas y quienes acaban 4.º se eliminan. Quien no promociona conserva curso e historial. Se puede hacer una vez por elección cerrada.
- **Tutoría de grupo:** cada profesor elige en su panel de qué grupo es tutor, o ninguno, y puede cambiarlo cuando quiera. Un grupo puede tener varios tutores. Ve un donut con el estado de su clase; al tocarlo, la lista de alumnos.
- **Recordatorio diario:** a las `REMINDER_HOUR` (hora de Madrid) se avisa al profesorado con solicitudes pendientes y, con la elección abierta, a los tutores de grupo con alumnos sin votar. El correo no da nombres: solo pide comprobar el panel y lleva el enlace. Para enviarlo en el momento: `npm run recordatori`.
- **Borrar respuesta:** con la elección abierta, administración puede borrar la respuesta de un alumno para que vuelva a votar.
- **Datos del alumno:** en «Les meues dades» solo se muestran. Con «Editar» indica qué profesor lo tiene a su cargo; ese profesor lo ve al momento en su panel y lo confirma o lo rechaza, sin correo. Confirmado, el alumno puede cambiarlos una vez; queda guardado en `student_data_changes` quién confirmó y los datos de antes y después. Mientras vota, los edita en la propia papereta.
- **Tiempo real:** cada cambio avisa por WebSocket a los clientes conectados, que vuelven a pedir sus datos a la API.

## Estructura

- `src/app.js`: rutas y permisos
- `src/election.js`: reglas de la elección
- `src/pdf.js`: cartel PDF en A3, una tabla por tutor; el alumnado sin tutor va en una hoja aparte que no se cuelga
- `src/mail.js`: envío por SMTP
- `src/live.js`: avisos por WebSocket
- `src/reminders.js`: recordatorio diario
- `src/db.js`: esquema SQLite (`data/tutoria.db`)
- `public/`: frontend
- `test/flujo.test.js`: prueba de extremo a extremo de la API
