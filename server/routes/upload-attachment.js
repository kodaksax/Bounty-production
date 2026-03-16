const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

// Create a service-role Supabase client for server-side uploads
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// POST /upload-attachment
// Accepts multipart/form-data with "file" and optional "path"; uploads to Supabase Storage
router.post('/', async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'Missing file' })
    }

    const file = req.files.file
    const path = (req.body.path || '').replace(/\/+$/, '')
    const filename = file.name || `upload-${Date.now()}`
    const keyPath = path ? `${path}/${filename}` : filename

    // Use Supabase storage client
    const bucket = 'MessageMedia'
    // req.files.file.data contains a Buffer
    const buffer = file.data

    const { error } = await supabase.storage.from(bucket).upload(keyPath, buffer, { upsert: true })
    if (error) return res.status(500).json({ error: error.message })

    const publicUrl = supabase.storage.from(bucket).getPublicUrl(keyPath).data.publicUrl

    res.json({ success: true, url: publicUrl })
  } catch (err) {
    console.error('[upload-attachment] error', err)
    res.status(500).json({ error: String(err) })
  }
})

module.exports = router
