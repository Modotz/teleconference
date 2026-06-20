export async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Original filename is sanitized for display only (browser may have set arbitrary chars)
  const safeName = req.file.originalname.replace(/[\r\n]/g, '').slice(0, 255);

  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    name: safeName,
    type: req.file.mimetype,
    size: req.file.size,
  });
}
