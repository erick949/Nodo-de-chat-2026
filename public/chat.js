var socket = io(); // mismo origen que la página (funciona también desde otros dispositivos)

var persona = document.getElementById('persona'),
    appChat = document.getElementById('app-chat'),
    panelBienvenida = document.getElementById('panel-bienvenida'),
    usuario = document.getElementById('usuario'),
    mensaje = document.getElementById('mensaje'),
    botonEnviar = document.getElementById('enviar'),
    escribiendoMensaje = document.getElementById('escribiendo-mensaje'),
    estadoSubida = document.getElementById('estado-subida'),
    output = document.getElementById('output'),
    ventanaMensajes = document.getElementById('ventana-mensajes'),
    botonAdjuntar = document.getElementById('adjuntar-btn'),
    inputArchivo = document.getElementById('file-input'),
    areaEntrada = document.getElementById('area-entrada'),
    botonMic = document.getElementById('mic-btn'),
    botonCancelarGrabacion = document.getElementById('cancelar-grabacion'),
    botonEnviarGrabacion = document.getElementById('enviar-grabacion'),
    tiempoGrabacion = document.getElementById('tiempo-grabacion'),
    barraRespuesta = document.getElementById('barra-respuesta'),
    respuestaNombre = document.getElementById('respuesta-nombre'),
    respuestaTexto = document.getElementById('respuesta-texto'),
    cerrarRespuesta = document.getElementById('cerrar-respuesta');

// Límite por archivo (debe coincidir con MAX_UPLOAD_MB del .env; el servidor lo vuelve a validar)
var LIMITE_MB = 100;

// Sonidos alojados en S3
var BUCKET_URL = 'https://chat-nodeerick-archivos-2026.s3.us-east-2.amazonaws.com/';
var sonidoEnviado = new Audio(BUCKET_URL + 'static/sounds/enviado.mp3');
var sonidoRecibido = new Audio(BUCKET_URL + 'static/sounds/recibido.mp3');
sonidoEnviado.preload = 'auto';
sonidoRecibido.preload = 'auto';

// Mensaje al que se está respondiendo (o null)
var respondiendoA = null;

// Cantidad de archivos subiéndose a S3 en este momento
var subidasActivas = 0;

/* =========================================================
   UTILIDADES
   ========================================================= */
function obtenerHora() {
    var fecha = new Date();
    var horas = fecha.getHours();
    var minutos = fecha.getMinutes();
    var ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12;
    horas = horas ? horas : 12;
    minutos = minutos < 10 ? '0' + minutos : minutos;
    return horas + ':' + minutos + ' ' + ampm;
}

function generarId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatearTamano(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatearDuracion(segundos) {
    var m = Math.floor(segundos / 60);
    var s = Math.floor(segundos % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function bajarScroll() {
    ventanaMensajes.scrollTop = ventanaMensajes.scrollHeight;
}

function reproducir(sonido) {
    sonido.currentTime = 0;
    sonido.play().catch(function () { /* el navegador puede bloquear el audio; no es grave */ });
}

// Texto corto que describe un mensaje (se usa en la cita de las respuestas)
function resumenDe(data) {
    var texto;
    switch (data.tipo) {
        case 'imagen':  texto = '📷 Imagen'; break;
        case 'video':   texto = '🎬 Video'; break;
        case 'audio':   texto = '🎤 Nota de voz'; break;
        case 'archivo': texto = '📎 ' + (data.nombre || 'Archivo'); break;
        default:        texto = data.texto || '';
    }
    return texto.length > 80 ? texto.slice(0, 80) + '…' : texto;
}

// Solo aceptamos enlaces https a la carpeta uploads/ de un bucket S3
// (evita "javascript:" y enlaces a sitios externos)
function esURLArchivo(valor) {
    return typeof valor === 'string' &&
        /^https:\/\/[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com\/uploads\//.test(valor);
}

// "audio/webm;codecs=opus" -> "audio/webm"
function mimeBase(mime) {
    return (mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

/* =========================================================
   ENVÍO DE MENSAJES
   ========================================================= */
// Arma el mensaje completo (id, usuario, hora, respuesta) y lo envía
function emitir(parcial) {
    var data = Object.assign({
        id: generarId(),
        usuario: usuario.value,
        hora: obtenerHora(),
        respuesta: respondiendoA
    }, parcial);

    socket.emit('chat', data);
    reproducir(sonidoEnviado);
    if (!('respuesta' in parcial)) cancelarRespuesta();
}

function enviarMensaje() {
    var texto = mensaje.value.trim();
    if (texto !== '') {
        emitir({ tipo: 'texto', texto: texto });
        mensaje.value = '';
    }
}

botonEnviar.addEventListener('click', enviarMensaje);

mensaje.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        enviarMensaje();
    }
});

/* =========================================================
   RESPONDER A UN MENSAJE
   ========================================================= */
function iniciarRespuesta(fila) {
    respondiendoA = {
        id: fila.dataset.id,
        usuario: fila.dataset.usuario,
        resumen: fila.dataset.resumen
    };
    respuestaNombre.textContent = respondiendoA.usuario;
    respuestaTexto.textContent = respondiendoA.resumen;
    barraRespuesta.style.display = 'flex';
    mensaje.focus();
}

function cancelarRespuesta() {
    respondiendoA = null;
    barraRespuesta.style.display = 'none';
}

cerrarRespuesta.addEventListener('click', cancelarRespuesta);

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && respondiendoA) cancelarRespuesta();
});

// Delegación de eventos: botón "responder" y clic en la cita
output.addEventListener('click', function (e) {
    var botonResponder = e.target.closest('.reply-btn');
    if (botonResponder) {
        iniciarRespuesta(botonResponder.closest('.message-row'));
        return;
    }

    var cita = e.target.closest('.quote');
    if (cita) {
        var original = document.querySelector('.message-row[data-id="' + cita.dataset.id + '"]');
        if (original) {
            original.scrollIntoView({ behavior: 'smooth', block: 'center' });
            original.classList.add('resaltado');
            setTimeout(function () { original.classList.remove('resaltado'); }, 1500);
        }
    }
});

/* =========================================================
   SUBIDA DE ARCHIVOS A S3
   ========================================================= */
function mostrarProgreso(texto) {
    estadoSubida.textContent = texto;
    estadoSubida.style.display = 'block';
    bajarScroll();
}

function ocultarProgreso() {
    estadoSubida.textContent = '';
    estadoSubida.style.display = 'none';
}

// 1) Pide al servidor una URL firmada  2) sube el archivo directo a S3
// Devuelve (en una promesa) la URL pública del archivo
function subirAS3(blob, nombre, mime) {
    return fetch('/subida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre, mime: mime, tamano: blob.size })
    }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (json) {
            if (!r.ok) throw new Error(json.error || 'No se pudo preparar la subida');
            return json;
        });
    }).then(function (firma) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('PUT', firma.uploadUrl);
            xhr.setRequestHeader('Content-Type', mime); // debe coincidir con el firmado

            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                    mostrarProgreso('Subiendo archivo… ' + Math.round(e.loaded / e.total * 100) + '%');
                }
            };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) resolve(firma.publicUrl);
                else reject(new Error('S3 rechazó la subida (código ' + xhr.status + ').'));
            };
            xhr.onerror = function () {
                reject(new Error('No se pudo conectar con S3. Revisa la configuración CORS del bucket.'));
            };
            xhr.send(blob);
        });
    });
}

// Sube el archivo y, al terminar, manda al chat solo el enlace
function enviarArchivo(blob, nombre, mime, tipo) {
    var respuesta = respondiendoA;   // la respuesta se queda con este archivo aunque tarde en subir
    cancelarRespuesta();

    subidasActivas++;
    mostrarProgreso('Subiendo archivo… 0%');

    subirAS3(blob, nombre, mime).then(function (url) {
        emitir({
            tipo: tipo,
            archivo: url,
            mime: mime,
            nombre: nombre,
            tamano: blob.size,
            texto: '',
            respuesta: respuesta
        });
    }).catch(function (err) {
        alert('No se pudo enviar el archivo: ' + err.message);
    }).then(function () {
        subidasActivas--;
        if (subidasActivas === 0) ocultarProgreso();
    });
}

/* =========================================================
   ADJUNTAR ARCHIVOS
   ========================================================= */
botonAdjuntar.addEventListener('click', function () {
    inputArchivo.click();
});

function tipoDeArchivo(mime) {
    if (mime.indexOf('image/') === 0) return 'imagen';
    if (mime.indexOf('video/') === 0) return 'video';
    if (mime.indexOf('audio/') === 0) return 'audio';
    return 'archivo';
}

inputArchivo.addEventListener('change', function (event) {
    var archivo = event.target.files[0];
    if (!archivo) return;

    if (archivo.size > LIMITE_MB * 1024 * 1024) {
        alert('El archivo pesa ' + formatearTamano(archivo.size) + '. El máximo es ' + LIMITE_MB + ' MB.');
        inputArchivo.value = '';
        return;
    }

    var mime = mimeBase(archivo.type);
    enviarArchivo(archivo, archivo.name, mime, tipoDeArchivo(mime));

    // Limpiar el input para poder subir el mismo archivo otra vez
    inputArchivo.value = '';
});

/* =========================================================
   GRABAR AUDIO
   ========================================================= */
var mediaRecorder = null,
    streamMic = null,
    trozos = [],
    grabacionCancelada = false,
    intervaloGrabacion = null,
    inicioGrabacion = 0;

function mimeGrabacionSoportado() {
    var candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < candidatos.length; i++) {
        if (MediaRecorder.isTypeSupported(candidatos[i])) return candidatos[i];
    }
    return '';
}

function extensionDeAudio(mime) {
    if (mime === 'audio/mp4') return 'm4a';
    if (mime === 'audio/ogg') return 'ogg';
    return 'webm';
}

function mostrarUIGrabacion(grabando) {
    areaEntrada.classList.toggle('grabando', grabando);
}

function iniciarGrabacion() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        alert('Tu navegador no permite grabar audio. Usa Chrome, Edge, Firefox o Safari actualizados.');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        streamMic = stream;
        var mime = mimeGrabacionSoportado();
        mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        trozos = [];
        grabacionCancelada = false;

        mediaRecorder.ondataavailable = function (e) {
            if (e.data && e.data.size > 0) trozos.push(e.data);
        };

        mediaRecorder.onstop = function () {
            // Apagar el micrófono (quita el indicador del navegador)
            streamMic.getTracks().forEach(function (t) { t.stop(); });
            clearInterval(intervaloGrabacion);
            mostrarUIGrabacion(false);

            if (grabacionCancelada || trozos.length === 0) return;

            var tipoMime = mimeBase(mediaRecorder.mimeType || mime || 'audio/webm');
            var blob = new Blob(trozos, { type: tipoMime });

            if (blob.size > LIMITE_MB * 1024 * 1024) {
                alert('La grabación es demasiado grande (máximo ' + LIMITE_MB + ' MB).');
                return;
            }

            enviarArchivo(blob, 'nota-de-voz.' + extensionDeAudio(tipoMime), tipoMime, 'audio');
        };

        mediaRecorder.start();
        inicioGrabacion = Date.now();
        tiempoGrabacion.textContent = '0:00';
        intervaloGrabacion = setInterval(function () {
            tiempoGrabacion.textContent = formatearDuracion((Date.now() - inicioGrabacion) / 1000);
        }, 250);
        mostrarUIGrabacion(true);
    }).catch(function () {
        alert('No se pudo acceder al micrófono. Revisa los permisos del navegador (y usa http://localhost o HTTPS).');
    });
}

function detenerGrabacion(cancelar) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    grabacionCancelada = !!cancelar;
    mediaRecorder.stop();
}

botonMic.addEventListener('click', iniciarGrabacion);
botonCancelarGrabacion.addEventListener('click', function () { detenerGrabacion(true); });
botonEnviarGrabacion.addEventListener('click', function () { detenerGrabacion(false); });

/* =========================================================
   RENDERIZADO DE MENSAJES
   ========================================================= */
// Descarga el archivo como Blob para forzar "guardar como" (los enlaces
// de otro dominio ignoran el atributo download). Si falla, lo abre en otra pestaña.
function descargarArchivo(url, nombre) {
    fetch(url).then(function (r) {
        if (!r.ok) throw new Error('descarga fallida');
        return r.blob();
    }).then(function (blob) {
        var objeto = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = objeto;
        a.download = nombre || 'archivo';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(objeto); }, 1000);
    }).catch(function () {
        window.open(url, '_blank', 'noopener');
    });
}

function crearContenidoArchivo(data) {
    var el;

    if (!esURLArchivo(data.archivo)) {
        el = document.createElement('span');
        el.textContent = '[archivo no válido]';
        return el;
    }

    if (data.tipo === 'imagen') {
        el = document.createElement('img');
        el.className = 'chat-image';
        el.alt = data.nombre || 'Imagen';
        el.src = data.archivo;
        el.addEventListener('load', bajarScroll);
        return el;
    }

    if (data.tipo === 'video') {
        el = document.createElement('video');
        el.className = 'chat-video';
        el.controls = true;
        el.preload = 'metadata';
        el.src = data.archivo;
        el.addEventListener('loadedmetadata', bajarScroll);
        return el;
    }

    if (data.tipo === 'audio') {
        el = document.createElement('audio');
        el.className = 'chat-audio';
        el.controls = true;
        el.preload = 'metadata';
        el.src = data.archivo;
        return el;
    }

    // Documentos (PDF, Word, Excel, ZIP, texto, etc.)
    var esPDF = data.mime === 'application/pdf';
    el = document.createElement('a');
    el.className = 'chat-file';
    el.href = data.archivo;
    el.target = '_blank';
    el.rel = 'noopener';

    // Todo menos el PDF se descarga en lugar de abrirse
    if (!esPDF) {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            descargarArchivo(data.archivo, data.nombre);
        });
    }

    var icono = document.createElement('i');
    icono.className = 'fas ' + (esPDF ? 'fa-file-pdf' : 'fa-file-arrow-down');

    var info = document.createElement('span');
    info.className = 'file-info';
    var nombre = document.createElement('span');
    nombre.className = 'file-name';
    nombre.textContent = data.nombre || 'Archivo';
    var detalle = document.createElement('span');
    detalle.className = 'file-size';
    detalle.textContent = (esPDF ? 'Abrir PDF' : 'Descargar') +
        (data.tamano ? ' · ' + formatearTamano(data.tamano) : '');
    info.appendChild(nombre);
    info.appendChild(detalle);

    el.appendChild(icono);
    el.appendChild(info);

    return el;
}

function crearBotonResponder() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'reply-btn';
    b.title = 'Responder';
    b.setAttribute('aria-label', 'Responder');
    b.innerHTML = '<i class="fas fa-reply"></i>';
    return b;
}

function crearMensaje(data) {
    var esMio = data.usuario === usuario.value;

    var fila = document.createElement('div');
    fila.className = 'message-row ' + (esMio ? 'me' : 'them');
    fila.dataset.id = data.id;
    fila.dataset.usuario = data.usuario;
    fila.dataset.resumen = resumenDe(data);

    var burbuja = document.createElement('div');
    burbuja.className = 'bubble';

    if (!esMio) {
        var nombre = document.createElement('strong');
        nombre.textContent = data.usuario;
        burbuja.appendChild(nombre);
    }

    // Cita del mensaje al que se responde
    if (data.respuesta) {
        var cita = document.createElement('div');
        cita.className = 'quote';
        cita.dataset.id = data.respuesta.id;
        var citaNombre = document.createElement('span');
        citaNombre.className = 'quote-name';
        citaNombre.textContent = data.respuesta.usuario;
        var citaTexto = document.createElement('span');
        citaTexto.className = 'quote-text';
        citaTexto.textContent = data.respuesta.resumen;
        cita.appendChild(citaNombre);
        cita.appendChild(citaTexto);
        burbuja.appendChild(cita);
    }

    // Contenido
    if (data.tipo && data.tipo !== 'texto') {
        burbuja.appendChild(crearContenidoArchivo(data));
    } else {
        var texto = document.createElement('div');
        texto.className = 'bubble-text';
        texto.textContent = data.texto;   // textContent: evita inyección de HTML
        burbuja.appendChild(texto);
    }

    var hora = document.createElement('span');
    hora.className = 'time';
    hora.textContent = data.hora || obtenerHora();
    burbuja.appendChild(hora);

    burbuja.appendChild(crearBotonResponder());
    fila.appendChild(burbuja);
    return fila;
}

socket.on('chat', function (data) {
    escribiendoMensaje.innerHTML = '';
    output.appendChild(crearMensaje(data));
    bajarScroll();

    // Sonido solo para mensajes de otras personas (ya dentro del chat)
    if (usuario.value && data.usuario !== usuario.value) reproducir(sonidoRecibido);
});

/* =========================================================
   "ESCRIBIENDO..."
   ========================================================= */
mensaje.addEventListener('keyup', function () {
    if (usuario.value) {
        socket.emit('typing', {
            nombre: usuario.value,
            texto: mensaje.value
        });
    }
});

socket.on('typing', function (data) {
    escribiendoMensaje.innerHTML = '';
    if (data.texto && data.nombre !== usuario.value) {
        var p = document.createElement('p');
        var em = document.createElement('em');
        em.textContent = data.nombre + ' está escribiendo...';
        p.appendChild(em);
        escribiendoMensaje.appendChild(p);
    }
});

/* =========================================================
   MENSAJES INICIALES (los del HTML también se pueden responder)
   ========================================================= */
(function prepararMensajesIniciales() {
    var filas = output.querySelectorAll('.message-row');
    filas.forEach(function (fila, i) {
        var burbuja = fila.querySelector('.bubble');
        var nombre = burbuja.querySelector('strong');

        fila.dataset.id = 'inicial-' + i;
        fila.dataset.usuario = nombre ? nombre.textContent : '';   // si es "me" se completa al entrar

        var copia = burbuja.cloneNode(true);
        ['strong', '.time'].forEach(function (sel) {
            var x = copia.querySelector(sel);
            if (x) x.remove();
        });
        var tieneImagen = copia.querySelector('img');
        var textoPlano = copia.textContent.replace(/\s+/g, ' ').trim();
        var resumen = textoPlano || (tieneImagen ? '📷 Imagen' : '');
        if (tieneImagen && textoPlano) resumen = '📷 ' + textoPlano;
        fila.dataset.resumen = resumen.length > 80 ? resumen.slice(0, 80) + '…' : resumen;

        burbuja.appendChild(crearBotonResponder());
    });
})();

/* =========================================================
   ENTRAR AL CHAT
   ========================================================= */
function ingresarAlChat() {
    if (persona.value.trim()) {
        panelBienvenida.style.display = 'none';
        appChat.style.display = 'flex';
        usuario.value = persona.value.trim();

        // Mostrar el nombre del usuario en el encabezado, el avatar y el mensaje inicial
        document.getElementById('header-nombre').textContent = usuario.value;
        document.getElementById('header-avatar').textContent = usuario.value.charAt(0).toUpperCase();
        output.querySelectorAll('.nombre-propio').forEach(function (el) {
            el.textContent = usuario.value;
            el.closest('.message-row').dataset.usuario = usuario.value;
        });

        // Los mensajes iniciales "me" pertenecen al usuario actual
        output.querySelectorAll('.message-row.me[data-usuario=""]').forEach(function (fila) {
            fila.dataset.usuario = usuario.value;
        });

        bajarScroll();
        mensaje.focus();
    }
}

persona.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') ingresarAlChat();
});