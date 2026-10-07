// Cargar el .env ANTES de requerir subidas.js (que lee process.env al cargarse)
require('dotenv').config()

const path = require('path')
const express = require('express')
const { Server } = require('socket.io')
const subidas = require('./subidas')

const PORT = process.env.PORT || 4000
const REGION = process.env.AWS_REGION
const BUCKET = process.env.S3_BUCKET

// Los archivos adjuntos solo pueden apuntar a nuestra carpeta uploads/ del bucket
const PREFIJO_ARCHIVOS = `https://${BUCKET}.s3.${REGION}.amazonaws.com/uploads/`
const TIPOS = ['texto', 'imagen', 'video', 'audio', 'archivo']

const app = express()
const server = app.listen(PORT, function () {
    console.log('Servidor corriendo en http://localhost:' + PORT)
})

app.use(express.static(path.join(__dirname, 'public')))
app.use(subidas) // POST /subida -> URL firmada para subir a S3

// Ya no viajan archivos por el socket (solo texto y enlaces), así que
// bastan 100 KB por mensaje en lugar de los 30 MB de antes.
const io = new Server(server, { maxHttpBufferSize: 1e5 })

function cortar(valor, max) {
    return typeof valor === 'string' ? valor.slice(0, max) : ''
}

// Nunca reenviamos lo que llega tal cual: solo los campos conocidos y validados
function limpiarMensaje(data) {
    if (!data || typeof data !== 'object') return null

    const tipo = TIPOS.includes(data.tipo) ? data.tipo : 'texto'
    const limpio = {
        id: cortar(data.id, 40),
        usuario: cortar(data.usuario, 50),
        hora: cortar(data.hora, 20),
        tipo: tipo,
        texto: cortar(data.texto, 2000),
        respuesta: null
    }
    if (!limpio.id || !limpio.usuario) return null

    if (data.respuesta && typeof data.respuesta === 'object') {
        limpio.respuesta = {
            id: cortar(data.respuesta.id, 40),
            usuario: cortar(data.respuesta.usuario, 50),
            resumen: cortar(data.respuesta.resumen, 100)
        }
    }

    if (tipo !== 'texto') {
        if (typeof data.archivo !== 'string' || !data.archivo.startsWith(PREFIJO_ARCHIVOS)) return null
        limpio.archivo = data.archivo
        limpio.mime = cortar(data.mime, 100)
        limpio.nombre = cortar(data.nombre, 200)
        limpio.tamano = Number.isFinite(data.tamano) ? data.tamano : 0
    }

    return limpio
}

io.on('connection', function (socket) {
    console.log('Hay una conexion', socket.id)

    socket.on('chat', function (data) {
        const mensaje = limpiarMensaje(data)
        if (!mensaje) return
        console.log({
            id: mensaje.id,
            usuario: mensaje.usuario,
            tipo: mensaje.tipo,
            texto: mensaje.texto,
            nombre: mensaje.nombre
        })
        io.emit('chat', mensaje)
    })

    socket.on('typing', function (data) {
        if (!data || typeof data !== 'object') return
        socket.broadcast.emit('typing', {
            nombre: cortar(data.nombre, 50),
            texto: cortar(data.texto, 2000)
        })
    })
})