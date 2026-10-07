// subidas.js — genera URLs firmadas para que el navegador suba archivos
// directamente a S3 (el servidor Node nunca recibe los archivos pesados).
// El .env se carga en index.js antes de requerir este archivo.
const express = require('express')
const crypto = require('crypto')
const path = require('path')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const router = express.Router()

const REGION = process.env.AWS_REGION
const BUCKET = process.env.S3_BUCKET
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100)

// Las credenciales (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) las toma
// el SDK automáticamente del .env (o del rol IAM si corre en EC2)
const s3 = new S3Client({
  region: REGION,
  // Evita que el SDK agregue checksums a la URL firmada (rompen la subida desde el navegador)
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
})

// Tipos permitidos (se excluyen html, svg y js a propósito)
const PERMITIDOS = [
  /^image\/(jpeg|png|gif|webp|avif)$/,
  /^video\/(mp4|webm|quicktime|ogg)$/,
  /^audio\/(webm|mp4|mpeg|ogg|wav|aac|x-m4a)$/,
  /^application\/pdf$/,
  /^application\/(zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed)$/,
  /^application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/,
  /^application\/vnd\.openxmlformats-officedocument\..+$/,
  /^text\/plain$/
]

router.post('/subida', express.json({ limit: '10kb' }), async (req, res) => {
  try {
    const { nombre, mime, tamano } = req.body || {}

    if (typeof nombre !== 'string' || typeof mime !== 'string') {
      return res.status(400).json({ error: 'Datos incompletos' })
    }
    if (!PERMITIDOS.some((re) => re.test(mime))) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido (' + mime + ')' })
    }
    if (!Number.isFinite(tamano) || tamano <= 0 || tamano > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ error: 'El archivo supera el máximo de ' + MAX_MB + ' MB' })
    }

    // Nombre aleatorio e impredecible: uploads/2026/10/<uuid>.<ext>
    const ext = path.extname(nombre).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)
    const hoy = new Date()
    const mes = String(hoy.getMonth() + 1).padStart(2, '0')
    const key = `uploads/${hoy.getFullYear()}/${mes}/${crypto.randomUUID()}${ext}`

    const comando = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mime
    })

    // La URL de subida vence en 5 minutos
    const uploadUrl = await getSignedUrl(s3, comando, { expiresIn: 300 })
    const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`

    res.json({ uploadUrl, publicUrl })
  } catch (err) {
    console.error('Error generando URL de subida:', err)
    res.status(500).json({ error: 'No se pudo preparar la subida' })
  }
})

module.exports = router