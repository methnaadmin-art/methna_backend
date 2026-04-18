require('dotenv').config();
const { google } = require('googleapis');

async function main() {
  const clientEmail = process.env.GOOGLE_PLAY_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PLAY_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const projectNumber = '898852362420';
  const serviceName = 'androidpublisher.googleapis.com';

  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_PLAY_CLIENT_EMAIL or GOOGLE_PLAY_PRIVATE_KEY');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const serviceUsage = google.serviceusage({ version: 'v1', auth });
  const resourceName = `projects/${projectNumber}/services/${serviceName}`;

  try {
    const stateResp = await serviceUsage.services.get({ name: resourceName });
    console.log('Service state:', stateResp.data.state || 'unknown');
  } catch (error) {
    console.error('services.get failed:', error?.response?.data || error?.message || error);
  }

  try {
    const enableResp = await serviceUsage.services.enable({ name: resourceName });
    console.log('Enable request accepted:', !!enableResp.data);
    console.log(JSON.stringify(enableResp.data, null, 2));
  } catch (error) {
    console.error('services.enable failed:', error?.response?.data || error?.message || error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
