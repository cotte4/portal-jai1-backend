# JAI1 Portal - Base de Conocimiento para Bot de Soporte

Este documento contiene toda la informacion relevante sobre las funcionalidades del portal JAI1 desde la perspectiva del cliente. Diseñado para ser utilizado por el bot de n8n para responder consultas de clientes en español.

---

## INDICE

1. [Dashboard Principal](#1-dashboard-principal)
2. [Seguimiento de Taxes](#2-seguimiento-de-taxes-tax-tracking)
3. [Mis Documentos](#3-mis-documentos)
4. [Soporte y Mensajes](#4-soporte-y-mensajes)
5. [Perfil y Registro](#5-perfil-y-registro)
6. [Programa de Referidos](#6-programa-de-referidos)
7. [Notificaciones](#7-notificaciones)
8. [Preguntas Frecuentes](#8-preguntas-frecuentes)
9. [Pagos y Comisiones](#9-pagos-y-comisiones)
10. [Estados Federales y Estatales](#10-estados-federales-y-estatales-detallado)
11. [Datos Clave para Respuestas Rapidas](#datos-clave-para-respuestas-rapidas)

---

## 1. DASHBOARD PRINCIPAL

### 1.1 Vista General del Dashboard

El dashboard es la pantalla principal que ve el cliente al iniciar sesion. Muestra un resumen completo del estado de su tramite de taxes.

### 1.2 Tarjeta de Reembolso Estimado

**Con W2 cargado:**
- Muestra el monto estimado en grande (ej: "$2,500 USD")
- Checkmark verde con texto "Calculado con tu W2"
- Boton para recalcular si es necesario

**Sin W2:**
- Icono de documento
- Texto: "Subi tu W2 para calcular"
- Boton: "Calcular mi reembolso" (lleva a calculadora)

### 1.3 Seccion de Progreso (Tu Progreso)

Muestra **3 pasos obligatorios** que el cliente debe completar:

| Paso | Icono | Descripcion | Boton de Accion |
|------|-------|-------------|-----------------|
| **1. Completa tu declaracion** | 📝 | Llenar formulario con datos personales y tributarios | "Completar declaracion" |
| **2. Subi tu documento W2** | 📄 | Cargar formulario W2 para calcular reembolso | "Ir a mis documentos" |
| **3. Subi tu comprobante de pago** | 💳 | Adjuntar comprobante del pago inicial ($30 USD) | "Ir a mis documentos" |

**Indicadores Visuales:**
- Barra de progreso: 1/3, 2/3, o 3/3 completados
- Puntos verdes (✓) para pasos completados
- Cuando completa los 3: "Preparacion completa - Todos los pasos completados correctamente" con badge 100%

### 1.4 Tarjeta de Seguimiento IRS

**Aparece despues de completar los 3 pasos:**
- Contador: "Paso X de 8"
- Badge de track: "Federal" (azul), "Estatal" (dorado), o "Federal + Estatal" (violeta)
- Titulo y descripcion del estado actual
- Anillo de progreso circular (0-100%)
- **Clickeable:** Lleva a pagina de Tax Tracking con timeline detallado

### 1.5 Banner de Problema

**Solo aparece si hay inconvenientes:**
- Borde rojo con animacion pulsante
- Icono de alerta (⚠️)
- Mensaje: "Necesitamos tu ayuda - Hay un inconveniente con tu tramite. Por favor contacta a soporte para resolverlo."
- Boton: "Contactar Soporte →" (lleva a mensajes)

### 1.6 Seccion de Ayuda

Siempre visible al final del dashboard:
- Mensaje: "Necesitas ayuda? Nuestro equipo esta listo para asistirte"
- Boton: "Contactar soporte"

---

## 2. SEGUIMIENTO DE TAXES (TAX TRACKING)

### 2.1 Acceso a Tax Tracking

- **Como llegar:** Desde el dashboard, hacer clic en la tarjeta de "Seguimiento IRS"
- **Proposito:** Ver el timeline detallado de tu proceso de devolucion

### 2.2 Los 8 Pasos del Proceso

El proceso completo se divide en **8 pasos** organizados en tres secciones:

#### Pasos Compartidos (1-2) - Aplican a Federal y Estatal

| Paso | Icono | Titulo | Descripcion |
|------|-------|--------|-------------|
| **1** | 📋 | Informacion Recibida | "Recibimos tus datos y documentos" |
| **2** | 🏛️ | Presentado al IRS | "Tu declaracion fue enviada al IRS" |

#### Track Federal (3-5) - Lado Izquierdo

| Paso | Icono | Titulo | Descripcion |
|------|-------|--------|-------------|
| **3** | 🦅 | Decision Federal | "Resultado del IRS Federal" |
| **4** | 📅 | Fecha Estimada | "Reembolso federal" |
| **5** | 💵 | Reembolso Enviado | "Federal depositado" |

#### Track Estatal (6-8) - Lado Derecho

| Paso | Icono | Titulo | Descripcion |
|------|-------|--------|-------------|
| **6** | 🗽 | Decision Estatal | "Resultado del IRS Estatal" |
| **7** | 📅 | Fecha Estimada | "Reembolso estatal" |
| **8** | 💵 | Reembolso Enviado | "Estatal depositado" |

### 2.3 Estados de Cada Paso

Cada paso puede estar en 4 estados:

| Estado | Indicador | Color | Significado |
|--------|-----------|-------|-------------|
| **Pendiente** | Numero en circulo | Gris | Proceso no iniciado |
| **Activo** | Punto pulsante | Azul | Procesando actualmente |
| **Completado** | Checkmark (✓) | Verde | Finalizado exitosamente |
| **Rechazado** | X roja | Rojo | Hubo un problema |

### 2.4 Diferencia Federal vs Estatal

| Aspecto | Federal | Estatal |
|---------|---------|---------|
| **Icono** | 🦅 Aguila | 🗽 Estatua Libertad |
| **Color** | Azul | Rosa/Dorado |
| **Procesamiento** | Independiente | Independiente |
| **Tiempo** | Variable (2-6 semanas) | Variable (2-8 semanas) |

**Importante:** Federal y Estatal procesan **independientemente**. Uno puede completarse antes que el otro.

### 2.5 Que Significa Cada Estado Federal/Estatal

| Estado | Significado | Que Hacer |
|--------|-------------|-----------|
| **En proceso** | IRS revisando declaracion | Esperar |
| **En verificacion** | IRS necesita verificar algo | Posible solicitud de documentos |
| **Verificacion en progreso** | Verificacion activa | Esperar respuesta |
| **Carta enviada** | IRS envio carta de verificacion | Revisar correo fisico |
| **Cheque en camino** | Cheque fisico enviado | Revisar buzon (7-14 dias) |
| **Deposito pendiente** | Listo para depositar | Esperar 1-3 dias habiles |
| **Reembolso enviado** | Proceso completado | Verificar cuenta bancaria |
| **Problemas** | Hay un inconveniente | Contactar soporte URGENTE |

### 2.6 Informacion Mostrada en Tax Tracking

**Tarjeta de Resumen:**
- Porcentaje de progreso total (0-100%)
- Reembolso estimado (si no ha llegado el final)
- Reembolso final (cuando se deposita)

**Por Cada Paso:**
- Icono del estado
- Titulo del paso
- Descripcion
- Fecha (cuando aplica)
- Monto (para reembolsos)

**Actualizaciones:**
- Boton de refrescar (🔄) para actualizar manualmente
- La pagina se actualiza automaticamente cada 30 segundos
- Muestra la hora de la ultima actualizacion

### 2.7 Animaciones y Celebraciones

- **Declaracion aprobada:** Notificacion de exito
- **Reembolso federal depositado:** Animacion de fuegos artificiales
- **Reembolso estatal depositado:** Animacion de lluvia de dinero
- **Confeti:** Al completar milestones importantes

---

## 3. MIS DOCUMENTOS

### 3.1 Acceso a Documentos

- **Como llegar:** Desde el dashboard hacer clic en "Ir a mis documentos", o desde el menu lateral seleccionar "Documentos"

### 3.2 Tipos de Documentos

| Tipo | Tab | Descripcion | Requerido |
|------|-----|-------------|-----------|
| **W2** | Formulario W2 | Documento de ingresos del empleador | ✅ Si |
| **Comprobante de Pago** | Pago | Screenshot del pago inicial de $30 USD | ✅ Si |
| **Otro** | Otros | Documentos adicionales de soporte | ❌ No |

### 3.3 Requisitos de Archivos

**Formatos Aceptados:**
- PDF (.pdf)
- PNG (.png)
- JPG/JPEG (.jpg, .jpeg)

**Limite de Tamaño:**
- Maximo: **25 MB** por archivo

### 3.4 Como Subir Documentos (Paso a Paso)

1. **Navegar** a la seccion "Documentos"
2. **Seleccionar tab** del tipo de documento (W2, Pago, u Otro)
3. **Cargar archivo:**
   - Arrastrar y soltar en la zona de carga, O
   - Clic en "Seleccionar archivos" para buscar
4. **Confirmar** tipo de documento en el dialogo
   - ⚠️ Advertencia: "No podras eliminar este documento luego de subirlo"
5. **Clic** en "Si, subir documento"
6. **Verificar** que aparece en "Documentos cargados"

### 3.5 Estados de Documentos

| Estado | Badge | Significado | Puede Eliminar |
|--------|-------|-------------|----------------|
| **Sin revisar** | - | Cargado, pendiente de verificacion | ✅ Si |
| **Revisado** | "Revisado" | Equipo JAI1 lo verifico | ❌ No (contactar soporte) |

### 3.6 Ver Documentos Cargados

Cada documento muestra:
- Icono del tipo de archivo
- Nombre del archivo
- Tamaño (KB, MB)
- Fecha y hora de carga
- Badge de estado (si fue revisado)
- Boton descargar (⬇️)
- Boton eliminar (🗑️) - solo si no fue revisado

### 3.7 Instrucciones de Pago

Para subir el **Comprobante de Pago**, primero debes realizar el pago de **$30 USD**:

**Metodos de Pago:**

| Metodo | Datos |
|--------|-------|
| **Zelle** | Email: pagos@jai1taxes.com / Nombre: JAI1 Tax Services LLC |
| **PayPal** | Email: paypal@jai1taxes.com |
| **Western Union** | Destinatario: JAI1 Tax Services / Ubicacion: Miami, FL |
| **MoneyGram** | Destinatario: JAI1 Tax Services / Ubicacion: Miami, FL |

**Despues del pago:** Tomar screenshot/captura y subirlo como Comprobante de Pago.

### 3.8 Pantalla de Exito

Cuando ambos documentos requeridos estan cargados:
- ✓ Documento W2 (checkmark verde)
- ✓ Comprobante de Pago (checkmark verde)
- Mensaje: "Tu documentacion esta lista para ser procesada. Nuestro equipo revisara todo y te notificaremos cualquier novedad."
- Opciones: Ver progreso / Ver mis documentos

### 3.9 Errores Comunes

| Error | Causa | Solucion |
|-------|-------|----------|
| "El archivo no es valido" | Formato no soportado | Convertir a PDF, PNG o JPG |
| "El archivo es muy grande" | Excede 25MB | Comprimir el archivo |
| "Este documento ya fue revisado" | Intentando eliminar documento revisado | Contactar soporte |

---

## 4. SOPORTE Y MENSAJES

### 4.1 Acceso a Soporte

- **Como llegar:** Desde el menu lateral seleccionar "Mensajes con Soporte", o hacer clic en cualquier boton de "Contactar Soporte"

### 4.2 Sistema de Tickets

#### Como Crear un Ticket Nuevo

1. Ir a "Mensajes con Soporte"
2. Clic en boton **"Nuevo mensaje"**
3. Completar formulario:
   - **Asunto:** Descripcion breve (ej: "Consulta sobre mi W2")
   - **Mensaje:** Detalles completos de tu pregunta o problema
4. Clic en **"Enviar consulta"**
5. Ticket creado - esperar respuesta

**Tiempo de Respuesta:** 24-48 horas habiles

#### Estados de Tickets

| Estado | Significado | Puede Enviar Mensajes |
|--------|-------------|----------------------|
| **Abierto** | Ticket creado, esperando respuesta del equipo | Si |
| **En Progreso** | El equipo esta trabajando en tu caso | Si |
| **Cerrado** | Problema resuelto | No (crear nuevo ticket) |

#### Como Responder en un Ticket

1. Seleccionar ticket de la lista (lado izquierdo)
2. Ver historial de conversacion
3. Escribir mensaje en el cuadro inferior
4. Presionar **Enter** o clic en boton de enviar (➤)
5. Mensaje aparece inmediatamente

### 4.3 Chatbot (Asistente JAI1)

#### Que es el Chatbot?

- **Nombre:** Asistente JAI1
- **Proposito:** Responder preguntas frecuentes sobre el proceso de taxes
- **Disponibilidad:** 24/7
- **Acceso:** Boton flotante en dashboard o seccion "Asistente JAI1"

#### Preguntas Rapidas (Botones)

| Boton | Pregunta que Envia |
|-------|-------------------|
| "Como funciona?" | "Como funciona el proceso de devolucion de impuestos?" |
| "Que documentos necesito?" | "Que documentos necesito para hacer mi declaracion de impuestos?" |
| "Cuanto tarda?" | "Cuanto tiempo tarda el proceso de devolucion?" |

#### Como Usar el Chatbot

1. Abrir chatbot (boton flotante 💬)
2. Bot saluda: "Hola! Soy el Asistente JAI1. Estoy aqui para ayudarte..."
3. Usar botones rapidos O escribir tu pregunta
4. Bot responde instantaneamente
5. Si necesitas ayuda especifica: Ir a "Mensajes con Soporte"

### 4.4 Consejos para Comunicacion Efectiva

**✅ Hacer:**
- Ser especifico sobre el problema
- Incluir detalles relevantes (año fiscal, tipo de documento, mensaje de error)
- Usar un ticket por tema
- Revisar respuestas existentes antes de crear nuevo ticket

**❌ No Hacer:**
- Crear multiples tickets para el mismo problema
- Compartir datos sensibles completos (SSN, numeros de banco)
- Esperar respuesta instantanea (usar chatbot para eso)

---

## 5. PERFIL Y REGISTRO

### 5.1 Proceso de Registro

#### Datos Requeridos

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Nombre | ✅ Si | - |
| Apellido | ✅ Si | - |
| Email | ✅ Si | Debe ser valido |
| Telefono | ❌ No | Recomendado |
| Codigo de referido | ❌ No | Da $11 de descuento |
| Contraseña | ✅ Si | Ver requisitos abajo |
| Aceptar T&C | ✅ Si | Obligatorio |

#### Requisitos de Contraseña

- Minimo 8 caracteres
- Al menos 1 mayuscula (A-Z)
- Al menos 1 minuscula (a-z)
- Al menos 1 numero (0-9)
- Al menos 1 caracter especial (@$!%*?&)

#### Pasos Post-Registro

1. Se envia email de verificacion
2. Usuario hace clic en el enlace del email
3. Cuenta se activa
4. Primer login redirige a Onboarding

### 5.2 Onboarding (Primera Vez)

**Paso 1: Bienvenida**
- Saludo personalizado con tu nombre
- Introduccion a JAI1

**Paso 2: Beneficios (3 slides)**
1. "Todo tu proceso de taxes, en un solo lugar"
2. "Segui el estado de tus taxes en tiempo real"
3. "Soporte cuando lo necesites"

**Paso 3: Verificacion de Documentos**
Confirmar que tienes:
- ✓ Formulario W2
- ✓ SSN (Social Security Number)
- ✓ Cuenta bancaria de USA

**Paso 4: Calculador de Reembolso (Opcional)**
- Subir W2 para obtener estimacion inmediata
- Muestra monto estimado de reembolso
- Puede omitirse y hacerse despues

**Paso 5: Completado**
- Redirige al Dashboard
- No vuelve a ver onboarding

### 5.3 Seccion de Perfil

#### Acceso
- **Como llegar:** Desde el menu lateral seleccionar "Mi Perfil"

#### Tarjeta de Miembro

- Foto de perfil (editable)
- Nombre completo
- Badge: "Miembro JAI1"
- "Miembro desde [mes/año]"
- SSN enmascarado (••••••XXXX)
- Estado de verificacion

#### Datos Personales (Editables)

| Campo | Editable | Notas |
|-------|----------|-------|
| Nombre | ✅ Si | - |
| Apellido | ✅ Si | - |
| Email | ❌ No | Fijo desde registro |
| Telefono | ✅ Si | - |
| Fecha de nacimiento | ✅ Si | Selector de fecha |
| Foto de perfil | ✅ Si | Max 5MB |

#### Domicilio (Editable)

| Campo | Descripcion |
|-------|-------------|
| Direccion | Calle y numero |
| Ciudad | Ciudad de residencia |
| Estado | Estado de USA |
| Codigo postal | ZIP code |

#### Informacion Fiscal (Sensible)

| Campo | Formato | Notas |
|-------|---------|-------|
| **SSN** | XXX-XX-XXXX | Mostrado enmascarado, requiere confirmacion para editar |

#### Informacion Bancaria (Sensible)

| Campo | Descripcion |
|-------|-------------|
| **Banco** | Nombre del banco |
| **Numero de Ruta** | 9 digitos (routing number) |
| **Numero de Cuenta** | Hasta 17 digitos |

**Proposito:** Para depositar tu reembolso directamente.

#### Credenciales TurboTax (Sensible)

| Campo | Descripcion |
|-------|-------------|
| **Email TurboTax** | Email de tu cuenta TurboTax |
| **Contraseña TurboTax** | Contraseña de TurboTax |

**Proposito:** El equipo JAI1 usa esto para preparar y presentar tu declaracion.

### 5.4 Seguridad de Datos

- Tus datos estan **encriptados** con tecnologia de nivel bancario
- La conexion es **100% segura** cuando usas el portal
- Solo personal autorizado de JAI1 puede acceder a tu informacion sensible
- Cualquier cambio a datos sensibles requiere **tu confirmacion explicita**
- Todas las acciones quedan registradas por seguridad

---

## 6. PROGRAMA DE REFERIDOS

### 6.1 Que es el Programa de Referidos?

Es un sistema donde puedes ganar **descuentos** compartiendo JAI1 con amigos y familiares. Ambas partes ganan beneficios reales.

### 6.2 Como Obtener tu Codigo

Tu codigo de referencia es **unico y personal**. Se obtiene automaticamente cuando:
- Te registras en JAI1
- Completas y envias tu declaracion de impuestos
- Te conviertes en un "JAIGENT" (miembro activo)

**Donde encontrarlo:** Seccion "Programa de Referidos" en el dashboard.

### 6.3 Beneficios del Programa

#### Para el Referido (nuevo usuario):
- **$11 USD de descuento** en su primera declaracion

#### Para Ti (quien comparte el codigo):

| Nivel | Referidos | Tu Descuento |
|-------|-----------|--------------|
| 1 | 1 referido | 5% |
| 2 | 2 referidos | 10% |
| 3 | 3 referidos | 20% |
| 4 | 4 referidos | 30% |
| 5 | 5 referidos | 50% |
| 6 | 6 referidos | 75% |
| 7+ | 7+ referidos | **100% GRATIS** |

Los descuentos se aplican a tu **proxima declaracion de impuestos**.

### 6.4 Como Compartir tu Codigo

Desde la seccion de referidos puedes compartir via:

| Metodo | Descripcion |
|--------|-------------|
| **WhatsApp** | Boton directo con mensaje preformulado |
| **Twitter/X** | Compartir en redes sociales |
| **Email** | Envio por correo electronico |
| **Copiar** | Clic en el codigo para copiarlo |

**Mensaje que se envia:**
> "Usa mi codigo [TU_CODIGO] en JAI1 y obten $11 de descuento en tu declaracion de taxes! https://jai1.app"

### 6.5 Estados de tus Referidos

| Estado | Significado |
|--------|-------------|
| **Pendiente** | Se registro con tu codigo |
| **Formulario enviado** | Completo su declaracion |
| **Esperando reembolso** | IRS procesando |
| **Exitoso** | ✓ Reembolso procesado (genera beneficios) |
| **Expirado** | No completo en tiempo |

### 6.6 Donde Ver tu Progreso

En la seccion "Programa de Referidos":
- **Tu codigo** con opciones de compartir
- **Total de referidos** completados
- **Tu nivel actual** y porcentaje de descuento
- **Barra de progreso** hacia el siguiente nivel
- **Lista de referidos** recientes con estados
- **Leaderboard** de top referidores

### 6.7 Reglas del Programa

- No se permite auto-referidos (crear multiples cuentas)
- Los codigos son personales e intransferibles
- JAI1 puede descalificar referidos fraudulentos
- Los beneficios no son canjeables por dinero en efectivo
- Los descuentos no se acumulan con otras promociones

---

## 7. NOTIFICACIONES

### 7.1 Como Ver Notificaciones

- **Icono de campana** (🔔) en esquina superior derecha
- Muestra contador de no leidas (9+ si son mas de 9)
- Clic abre panel lateral de notificaciones
- Lista cronologica (mas recientes primero)
- Boton "Cargar mas" para ver antiguas

### 7.2 Tipos de Notificaciones

| Tipo | Icono | Significado | Accion Recomendada |
|------|-------|-------------|-------------------|
| **Cambio de Estado** | 📊 | Tu caso avanzo un paso | Revisar Tax Tracking |
| **Documentos Faltantes** | 📁 | Se necesitan documentos | Ir a Documentos |
| **Respuesta de Soporte** | 💬 | El equipo respondio tu ticket | Ir a Mensajes |
| **Alerta de Problema** | ⚠️ | Hay un problema con tu caso | Contactar soporte |
| **Referido** | 🎁 | Alguien uso tu codigo | Ver Programa de Referidos |
| **Sistema** | ⚙️ | Anuncios del sistema | Informativo |

### 7.3 Ejemplos de Notificaciones

| Notificacion | Significado |
|--------------|-------------|
| "Declaracion federal enviada al IRS" | Tu declaracion fue presentada |
| "El IRS esta procesando tu declaracion" | En revision por el IRS |
| "¡Tu reembolso federal fue aprobado!" | Aprobado, deposito en camino |
| "¡Reembolso federal depositado!" | Dinero ya esta en tu cuenta |
| "Declaracion rechazada" | Problema - contactar soporte |
| "Alguien uso tu codigo de referido!" | Nuevo referido registrado |
| "¡Tu referido fue exitoso!" | Ganaste descuento |

### 7.4 Gestionar Notificaciones

| Accion | Como Hacerlo |
|--------|--------------|
| **Marcar como leida** | Clic en la notificacion |
| **Marcar todas leidas** | Boton "Marcar leidas" |
| **Eliminar una** | Icono de basura al pasar mouse |
| **Eliminar todas leidas** | Boton "Borrar leidas" |

### 7.5 Entrega de Notificaciones

**En la App:**
- Notificaciones en tiempo real
- Sonido de alerta (puede deshabilitarse)
- Aviso temporal en la esquina de la pantalla
- El contador se actualiza automaticamente

**Por Email:**
- Actualmente solo notificaciones en la app
- Proximamente: Notificaciones por email

---

## 8. PREGUNTAS FRECUENTES

### Registro y Cuenta

**P: Puedo registrarme con Google?**
R: Si, hay opcion de registro con Google disponible.

**P: No recibi el email de verificacion**
R: Revisa la carpeta de spam. Si no esta, contacta soporte.

**P: Olvide mi contraseña**
R: Usa la opcion "Olvide mi contraseña" en la pagina de login.

**P: Como cambio mi email?**
R: El email no puede cambiarse. Contacta soporte si necesitas ayuda.

### Documentos

**P: Que pasa si mi W2 tiene errores?**
R: Contacta a tu empleador para obtener un W2 corregido (W2-C).

**P: Puedo subir multiples W2?**
R: Si, si trabajaste para varios empleadores, sube todos tus W2.

**P: En que formato debe estar mi W2?**
R: PDF, PNG o JPG. Maximo 25MB. Asegurate que sea legible.

**P: Como elimino un documento?**
R: Solo puedes eliminar documentos que no han sido revisados. Si ya fue revisado, contacta soporte.

### Proceso de Taxes

**P: Cuanto tiempo tarda el reembolso?**
R: Tipicamente 2-6 semanas despues de presentar, dependiendo del IRS.

**P: Federal y estatal llegan al mismo tiempo?**
R: No necesariamente. Son procesos independientes y pueden llegar en diferentes momentos.

**P: Que significa "En verificacion"?**
R: El IRS necesita verificar alguna informacion. Puede requerir documentos adicionales o una carta.

**P: Que hago si mi declaracion fue rechazada?**
R: Contacta soporte inmediatamente para resolver el problema.

**P: Puedo ver mi declaracion antes de enviarla?**
R: El equipo JAI1 prepara la declaracion. Si tienes preguntas, contacta soporte.

### Pagos y Costos

**P: Cuanto cuesta el servicio?**
R: Pago inicial de $30 USD + comision sobre el reembolso.

**P: Como pago los $30?**
R: Via Zelle, PayPal, Western Union o MoneyGram. Ver instrucciones en seccion Documentos.

**P: Que pasa si no recibo reembolso?**
R: Si el IRS determina que no hay reembolso, solo pagas los $30 iniciales.

**P: Cuando se cobra la comision?**
R: La comision se descuenta automaticamente del reembolso antes del deposito.

### Referidos

**P: Donde encuentro mi codigo de referido?**
R: En la seccion "Programa de Referidos" del dashboard.

**P: Cuando recibo mi descuento por referir?**
R: Cuando tu referido completa exitosamente su proceso de taxes.

**P: Puedo referir a familiares?**
R: Si, puedes referir a cualquier persona que califique para el servicio.

**P: Hay limite de referidos?**
R: No, puedes referir a todas las personas que quieras.

### Soporte

**P: Cuanto tardan en responder?**
R: 24-48 horas habiles tipicamente.

**P: Puedo llamar por telefono?**
R: Actualmente el soporte es via chat/tickets. Estamos trabajando en soporte telefonico.

**P: El chatbot puede resolver mi problema especifico?**
R: El chatbot responde preguntas generales. Para problemas especificos de tu cuenta, usa Mensajes con Soporte.

### Seguridad

**P: Es seguro compartir mi SSN?**
R: Si, tus datos estan protegidos con encriptacion de nivel bancario y solo personal autorizado de JAI1 tiene acceso.

**P: Quien puede ver mi informacion bancaria?**
R: Solo el equipo autorizado de JAI1 que procesa tu reembolso. Nadie mas.

**P: Como se protegen mis datos?**
R: Usamos encriptacion de nivel bancario, conexiones 100% seguras, y auditorias regulares de seguridad.

---

## 9. PAGOS Y COMISIONES

### 9.1 Estructura de Costos

#### Pago Inicial ($30 USD)

| Concepto | Detalle |
|----------|---------|
| **Monto** | $30 USD |
| **Cuando se paga** | Al comenzar el proceso |
| **Es reembolsable?** | No, cubre costos administrativos |
| **Que incluye** | Preparacion de declaracion, soporte durante proceso |

**Metodos de Pago:**
- Zelle (pagos@jai1taxes.com)
- PayPal (paypal@jai1taxes.com)
- Western Union (JAI1 Tax Services, Miami FL)
- MoneyGram (JAI1 Tax Services, Miami FL)

#### Comision sobre Reembolso

| Concepto | Detalle |
|----------|---------|
| **Porcentaje** | Variable segun caso |
| **Cuando se cobra** | Se descuenta automaticamente del reembolso |
| **Como se calcula** | Porcentaje del reembolso total (federal + estatal) |
| **Si no hay reembolso** | Solo se paga el pago inicial de $30 |

### 9.2 Descuentos Disponibles

| Tipo de Descuento | Monto/Porcentaje | Como Obtenerlo |
|-------------------|------------------|----------------|
| **Codigo de referido (nuevo)** | $11 USD | Usar codigo al registrarse |
| **Por referir 1 persona** | 5% | Programa de referidos |
| **Por referir 2 personas** | 10% | Programa de referidos |
| **Por referir 3 personas** | 20% | Programa de referidos |
| **Por referir 4 personas** | 30% | Programa de referidos |
| **Por referir 5 personas** | 50% | Programa de referidos |
| **Por referir 6 personas** | 75% | Programa de referidos |
| **Por referir 7+ personas** | 100% (GRATIS) | Programa de referidos |

### 9.3 Preguntas sobre Pagos

**P: Que pasa si no me aprueban reembolso?**
R: Solo pagas los $30 iniciales. No hay comision si no hay reembolso.

**P: Puedo pagar la comision por separado?**
R: No, la comision se descuenta automaticamente del reembolso antes del deposito.

**P: El descuento de referido aplica a la comision?**
R: Si, los descuentos reducen el porcentaje de comision cobrado.

**P: Puedo pagar con tarjeta de credito?**
R: Actualmente solo aceptamos Zelle, PayPal, Western Union y MoneyGram.

---

## 10. ESTADOS FEDERALES Y ESTATALES (DETALLADO)

### 10.1 Que son los Estados Federal y Estatal?

En Estados Unidos, los impuestos se pagan a **dos niveles**:

| Nivel | Entidad | Que Grava | Reembolso |
|-------|---------|-----------|-----------|
| **Federal** | IRS (Internal Revenue Service) | Ingresos a nivel nacional | Reembolso Federal |
| **Estatal** | Departamento de Impuestos del Estado | Ingresos en el estado donde trabajaste | Reembolso Estatal |

**Importante:** Cada nivel procesa **independientemente**. Puedes recibir el federal antes que el estatal, o viceversa.

### 10.2 Estados Federales (Detallado)

| Estado | Descripcion | Tiempo Tipico | Que Hacer |
|--------|-------------|---------------|-----------|
| **En Proceso** | El IRS recibio tu declaracion y la esta revisando | 2-4 semanas | Esperar pacientemente |
| **En Verificacion** | El IRS necesita verificar informacion adicional | Variable | Revisar notificaciones |
| **Verificacion en Progreso** | El proceso de verificacion esta activo | 2-6 semanas | Responder si te solicitan algo |
| **Carta de Verificacion Enviada** | El IRS envio una carta fisica a tu direccion | - | Revisar tu buzon y responder la carta |
| **Cheque en Camino** | El IRS envio un cheque fisico por correo | 7-14 dias | Revisar tu buzon diariamente |
| **Deposito Pendiente** | Tu reembolso fue aprobado, esperando transferencia | 1-3 dias habiles | Verificar tu cuenta bancaria |
| **Reembolso Enviado** | El dinero esta en camino a tu cuenta | 1-2 dias | Verificar el deposito |
| **Completado** | Reembolso depositado exitosamente | - | Listo! Disfruta tu dinero |
| **Problemas** | Hay un inconveniente que requiere atencion | Urgente | Contactar soporte INMEDIATAMENTE |

### 10.3 Estados Estatales (Detallado)

Los estados estatales son **identicos a los federales**, pero aplicados al proceso del estado donde trabajaste.

| Estado | Descripcion | Tiempo Tipico |
|--------|-------------|---------------|
| **En Proceso** | Estado revisando tu declaracion | 2-6 semanas |
| **En Verificacion** | Estado necesita verificar algo | Variable |
| **Verificacion en Progreso** | Verificacion activa con el estado | 2-8 semanas |
| **Carta de Verificacion Enviada** | Carta del estado enviada | Revisar correo |
| **Cheque en Camino** | Cheque estatal enviado | 7-14 dias |
| **Deposito Pendiente** | Listo para depositar | 1-3 dias |
| **Reembolso Enviado** | Dinero estatal en camino | 1-2 dias |
| **Completado** | Reembolso estatal depositado | - |
| **Problemas** | Inconveniente con el estado | Contactar soporte |

### 10.4 Por que Federal y Estatal Tardan Diferente?

| Factor | Federal (IRS) | Estatal |
|--------|---------------|---------|
| **Volumen** | Millones de declaraciones | Menos volumen |
| **Proceso** | Estandarizado | Varia por estado |
| **Tiempo tipico** | 2-6 semanas | 2-8 semanas |
| **Verificaciones** | Frecuentes | Menos frecuentes |

**Ejemplo Real:**
- Dia 1: Presentas declaracion
- Semana 3: Federal aprobado
- Semana 4: Federal depositado
- Semana 6: Estatal aprobado
- Semana 7: Estatal depositado

### 10.5 Que Hacer en Cada Estado

| Situacion | Accion Recomendada |
|-----------|-------------------|
| **En proceso** | Esperar pacientemente. Es normal. |
| **En verificacion** | Revisar notificaciones. Puede que te pidan documentos. |
| **Carta enviada** | Revisar tu buzon fisico URGENTE. Responder dentro del plazo. |
| **Cheque en camino** | Revisar buzon diariamente. |
| **Deposito pendiente** | Verificar que tu info bancaria este correcta. |
| **Problemas** | Contactar soporte INMEDIATAMENTE. |

### 10.6 Tiempos de Procesamiento IRS

| Tipo de Declaracion | Tiempo Federal | Tiempo Estatal |
|--------------------|----------------|----------------|
| **Electronica simple** | 2-3 semanas | 2-4 semanas |
| **Electronica con verificacion** | 4-8 semanas | 4-10 semanas |
| **Con carta del IRS** | 8-12 semanas | 8-12 semanas |
| **Con problemas** | Variable | Variable |

**Nota:** Estos tiempos son estimados. El IRS puede tardar mas en temporada alta (febrero-abril).

---

## DATOS CLAVE PARA RESPUESTAS RAPIDAS

### Tiempos de Respuesta

| Servicio | Tiempo |
|----------|--------|
| Soporte humano | 24-48 horas habiles |
| Chatbot | Instantaneo |
| Actualizacion de estado | Automatico cada 30 segundos |
| Procesamiento IRS Federal | 2-6 semanas |
| Procesamiento IRS Estatal | 2-8 semanas |

### Contacto y Pagos

| Para | Donde/Como |
|------|------------|
| **Soporte** | Seccion "Mensajes con Soporte" en la app |
| **Preguntas rapidas** | Asistente JAI1 (boton flotante) |
| **Pago por Zelle** | pagos@jai1taxes.com (JAI1 Tax Services LLC) |
| **Pago por PayPal** | paypal@jai1taxes.com |
| **Western Union/MoneyGram** | JAI1 Tax Services, Miami FL |

### Montos Importantes

| Concepto | Monto |
|----------|-------|
| **Pago inicial** | $30 USD |
| **Descuento por usar codigo de referido** | $11 USD |
| **Descuento maximo por referir amigos** | 100% gratis (con 7+ referidos) |

### Secciones del Portal

| Seccion | Para que sirve |
|---------|----------------|
| **Dashboard** | Ver resumen de tu caso y progreso |
| **Seguimiento** | Ver el estado detallado paso a paso |
| **Documentos** | Subir W2 y comprobante de pago |
| **Mensajes** | Contactar al equipo de soporte |
| **Perfil** | Actualizar tus datos personales y bancarios |
| **Referidos** | Ver tu codigo y ganar descuentos |

---

*Base de conocimiento para el bot de soporte JAI1*
*Ultima actualizacion: Enero 2026*
*Version: 2.1*
