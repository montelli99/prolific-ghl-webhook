const https = require('https');

const API_KEY = 'pit-598ce224-4abf-4b4b-be79-7ee3c3bfd17f';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const USER_ID = 'PGfXxlXCRXs3hXN3Gq7R';
const PIPELINE_ID = 'ygQaJ2hi7ouJeA5HR7uu';

const leads = [
  {
    firstName: '', lastName: 'KEDA PROPERTIES LLC',
    address1: '433 Lime Ave', city: 'Daytona Beach', state: 'FL', zip: '32124-3773',
    propertyAddress: '1400 N Simpson St', propertyCity: 'Mount Dora', propertyState: 'FL', propertyZip: '32757-3948',
    phone: '', email: '',
    arv: 302175, equity: 302175, mlsPrice: 299000,
    mlsAgent: "Tom O'Brien", mlsPhone: '4073884242', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Hung Thanh', lastName: 'Nguyen',
    address1: '3070 Cat Tail Ln', city: 'Debary', state: 'FL', zip: '32713-2775',
    propertyAddress: '1501 Fort Smith Blvd', propertyCity: 'Deltona', propertyState: 'FL', propertyZip: '32725-4922',
    phone: '', email: '',
    arv: 276039, equity: 151039, mlsPrice: 264900,
    mlsAgent: 'Matt White', mlsPhone: '4077583166', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Shirley', lastName: 'Richards',
    address1: 'PO Box 2031', city: 'Lakeland', state: 'FL', zip: '33806-2031',
    propertyAddress: '1049 Plateau Ave', propertyCity: 'Lakeland', propertyState: 'FL', propertyZip: '33815-3937',
    phone: '', email: '',
    arv: 220800, equity: 185568, mlsPrice: 220000,
    mlsAgent: 'Donna Williams', mlsPhone: '8637013663', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: '', lastName: 'NIX FAMILY TRUST',
    address1: '37151 County Road 452', city: 'Grand Island', state: 'FL', zip: '32735-9102',
    propertyAddress: '1603 Rose Ln', propertyCity: 'Eustis', propertyState: 'FL', propertyZip: '32726-3143',
    phone: '', email: '',
    arv: 183336, equity: 165186, mlsPrice: 174900,
    mlsAgent: 'Laurie Laventhall', mlsPhone: '4072072220', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Susan D', lastName: 'Howell',
    address1: '512 Jackson St', city: 'Eustis', state: 'FL', zip: '32726-4527',
    propertyAddress: '102 E Pendleton Ave', propertyCity: 'Eustis', propertyState: 'FL', propertyZip: '32726-2818',
    phone: '', email: '',
    arv: 284553, equity: 209901, mlsPrice: 214900,
    mlsAgent: 'Matt Buttner', mlsPhone: '3523857636', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: '', lastName: 'DAVID J GARDNER REV TRUST',
    address1: '8210 Via Bella St', city: 'Sanford', state: 'FL', zip: '32771-9752',
    propertyAddress: '5610 Wilson Rd', propertyCity: 'Sanford', propertyState: 'FL', propertyZip: '32771-8604',
    phone: '', email: '',
    arv: 276633, equity: 190200, mlsPrice: 274900,
    mlsAgent: 'Tanya Miller', mlsPhone: '4074746665', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Guadalupe', lastName: 'Desantiago',
    address1: '1015 E Bougainvillea Way', city: 'Bartow', state: 'FL', zip: '33830-7239',
    propertyAddress: '1950 E Valencia Dr', propertyCity: 'Bartow', propertyState: 'FL', propertyZip: '33830-7151',
    phone: '', email: '',
    arv: 167800, equity: 167800, mlsPrice: 167000,
    mlsAgent: 'Craig Burke', mlsPhone: '8638995010', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Dempsey', lastName: 'Hensley',
    address1: 'PO Box 992', city: 'Frostproof', state: 'FL', zip: '33843-0992',
    propertyAddress: '352 Hwy 630 E', propertyCity: 'Frostproof', propertyState: 'FL', propertyZip: '33843-9766',
    phone: '', email: '',
    arv: 217000, equity: 217000, mlsPrice: 237400,
    mlsAgent: 'Cindy Wise', mlsPhone: '8635280366', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: '', lastName: 'PINVEST PROPERTIES INC',
    address1: '265 Hammock Oak Cir', city: 'Debary', state: 'FL', zip: '32713-4906',
    propertyAddress: '2870 Valmont Ln', propertyCity: 'Deltona', propertyState: 'FL', propertyZip: '32738-5255',
    phone: '', email: '',
    arv: 330230, equity: 282061, mlsPrice: 279900,
    mlsAgent: 'Carlos Lopez Sotomayor', mlsPhone: '4079632955', mlsStatus: 'Active',
    tag: 'Wholesale'
  },
  {
    firstName: 'Candace', lastName: 'Ray',
    address1: '6401 Kyle Ave', city: 'Fort Collins', state: 'CO', zip: '80525-4111',
    propertyAddress: '11411 Huggins St', propertyCity: 'Leesburg', propertyState: 'FL', propertyZip: '34788-4716',
    phone: '', email: '',
    arv: 248145, equity: 196475, mlsPrice: 189000,
    mlsAgent: 'Leah Laboy', mlsPhone: '3529104984', mlsStatus: 'Active',
    tag: 'Wholesale'
  }
];

function apiRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : undefined;
    const o = {
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };
    const r = https.request(o, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d || '{}') }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function importLeads() {
  console.log(`Starting import of ${leads.length} leads for user ${USER_ID}...`);
  
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const name = lead.firstName ? `${lead.firstName} ${lead.lastName}` : lead.lastName;
    console.log(`\n[${i+1}/${leads.length}] Importing: ${name} - ${lead.propertyAddress}`);
    
    try {
      // Step 1: Create contact
      const contactData = {
        locationId: LOCATION_ID,
        firstName: lead.firstName || '',
        lastName: lead.lastName,
        address1: lead.address1,
        city: lead.city,
        state: lead.state,
        postalCode: lead.zip,
        country: 'US',
        phone: lead.phone || undefined,
        email: lead.email || undefined,
        source: 'Course Import',
        tags: [lead.tag],
        customFields: [
          { key: 'arv', field_value: lead.arv.toString() },
          { key: 'equity', field_value: lead.equity.toString() },
          { key: 'mls_listing_price', field_value: lead.mlsPrice.toString() },
          { key: 'mls_status', field_value: lead.mlsStatus },
          { key: 'mls_agent_name', field_value: lead.mlsAgent },
          { key: 'mls_agent_phone', field_value: lead.mlsPhone },
          { key: 'property_address', field_value: lead.propertyAddress },
          { key: 'property_city', field_value: lead.propertyCity },
          { key: 'property_state', field_value: lead.propertyState },
          { key: 'property_zip', field_value: lead.propertyZip }
        ]
      };

      const contactRes = await apiRequest('POST', '/contacts/', contactData);
      
      if (contactRes.status !== 200 && contactRes.status !== 201) {
        console.log(`  ❌ Contact failed (${contactRes.status}):`, JSON.stringify(contactRes.data).substring(0, 200));
        continue;
      }
      
      const contactId = contactRes.data.contact?.id || contactRes.data.id;
      console.log(`  ✅ Contact created: ${contactId}`);

      // Step 2: Create opportunity
      const oppData = {
        locationId: LOCATION_ID,
        name: `${lead.propertyAddress}, ${lead.propertyCity} ${lead.propertyState}`,
        pipelineId: PIPELINE_ID,
        pipelineStageId: 'New',
        assignedTo: USER_ID,
        contactId: contactId,
        source: 'Course Import',
        status: 'open',
        customFields: [
          { key: 'arv', field_value: lead.arv.toString() },
          { key: 'equity', field_value: lead.equity.toString() },
          { key: 'mls_listing_price', field_value: lead.mlsPrice.toString() },
          { key: 'mls_status', field_value: lead.mlsStatus },
          { key: 'mls_agent_name', field_value: lead.mlsAgent },
          { key: 'mls_agent_phone', field_value: lead.mlsPhone }
        ],
        monetaryValue: lead.arv
      };

      const oppRes = await apiRequest('POST', '/opportunities/', oppData);
      
      if (oppRes.status !== 200 && oppRes.status !== 201) {
        console.log(`  ❌ Opportunity failed (${oppRes.status}):`, JSON.stringify(oppRes.data).substring(0, 200));
        continue;
      }
      
      const oppId = oppRes.data.opportunity?.id || oppRes.data.id;
      console.log(`  ✅ Opportunity created: ${oppId}`);
      
      // Add delay between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
      
    } catch (err) {
      console.log(`  ❌ Error:`, err.message);
    }
  }
  
  console.log('\n✅ Import complete!');
}

importLeads().catch(console.log);