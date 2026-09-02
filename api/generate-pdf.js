const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { google } = require('googleapis');
const { Readable } = require('stream');

function setCors(res, origin){
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res, req.headers.origin);
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  let browser;
  try{
    const { html, filename } = req.body || {};
    if(!html || !filename){
      res.status(400).json({ error: 'Falta html o filename' });
      return;
    }

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    await browser.close();
    browser = null;

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
        mimeType: 'application/pdf'
      },
      media: {
        mimeType: 'application/pdf',
        body: Readable.from(pdfBuffer)
      }
    });

    res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    if(browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};
