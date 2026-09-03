const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { GoogleAuth } = require('google-auth-library');

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
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const boundary = 'lidzpropuesta' + Date.now();
    const metadata = {
      name: filename,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      mimeType: 'application/pdf'
    };
    const base64Data = pdfBuffer.toString('base64');
    const body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64Data + '\r\n' +
      '--' + boundary + '--';

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
      },
      body
    });
    if(!uploadRes.ok){
      const texto = await uploadRes.text().catch(() => '');
      throw new Error('Drive respondió ' + uploadRes.status + ': ' + texto);
    }

    res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    if(browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};
