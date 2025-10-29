require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const API_BASE = 'https://api.ultravox.ai/api';

async function convertJSONToMarkdown(jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const pets = data.pets || data; // Handle both {pets: []} and [] structures

  let markdown = '# Popular Pet Breeds Knowledge Base\n\n';
  markdown += 'This document contains information about common pet species and breeds for veterinary reference.\n\n';

  // Group by species
  const bySpecies = {};
  pets.forEach(pet => {
    if (!bySpecies[pet.species]) {
      bySpecies[pet.species] = [];
    }
    bySpecies[pet.species].push(pet);
  });

  // Generate markdown for each species
  Object.keys(bySpecies).sort().forEach(species => {
    markdown += `\n## ${species}\n\n`;

    bySpecies[species].forEach(pet => {
      markdown += `### ${pet.breed}\n\n`;
      markdown += `- **Category**: ${pet.category}\n`;
      markdown += `- **Size**: ${pet.size}\n`;
      if (pet.commonNames && pet.commonNames.length > 0) {
        markdown += `- **Common Names**: ${pet.commonNames.join(', ')}\n`;
      }
      markdown += '\n';
    });
  });

  return markdown;
}

async function createCorpus() {
  console.log('Creating corpus...');

  const response = await fetch(`${API_BASE}/corpora`, {
    method: 'POST',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Pet Breeds Knowledge Base',
      description: 'Common pet species, breeds, and their characteristics for veterinary triage and consultation'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create corpus: ${error}`);
  }

  const corpus = await response.json();
  console.log(`✓ Created corpus with ID: ${corpus.corpusId}`);
  return corpus.corpusId;
}

async function requestUploadURL(corpusId, fileName) {
  console.log('Requesting upload URL...');

  const response = await fetch(`${API_BASE}/corpora/${corpusId}/uploads`, {
    method: 'POST',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mimeType: 'text/markdown',
      fileName: fileName
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to request upload URL: ${error}`);
  }

  const upload = await response.json();
  console.log(`✓ Received upload URL for document ID: ${upload.documentId}`);
  return upload;
}

async function uploadDocument(presignedUrl, content) {
  console.log('Uploading document...');

  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/markdown'
    },
    body: content
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload document: ${error}`);
  }

  console.log('✓ Document uploaded successfully');
}

async function createSource(corpusId, documentId) {
  console.log('Creating corpus source...');

  const response = await fetch(`${API_BASE}/corpora/${corpusId}/sources`, {
    method: 'POST',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Popular Pet Breeds',
      description: '200 common pet species and breeds with categorization',
      upload: {
        documentIds: [documentId]
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create source: ${error}`);
  }

  const source = await response.json();
  console.log(`✓ Created source with ID: ${source.sourceId}`);
  return source.sourceId;
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Creating Pet Breeds Corpus in Ultravox');
    console.log('='.repeat(60));
    console.log();

    // Step 1: Convert JSON to Markdown
    const jsonPath = path.join(__dirname, '..', 'ai-agent-definitions', 'popularPetsCorpus.json');
    console.log(`Reading pet breeds from: ${jsonPath}`);
    const markdown = await convertJSONToMarkdown(jsonPath);
    console.log(`✓ Converted ${markdown.split('\n').length} lines of markdown\n`);

    // Step 2: Create corpus
    const corpusId = await createCorpus();

    // Step 3: Request upload URL
    const {documentId, presignedUrl} = await requestUploadURL(corpusId, 'pet-breeds.md');

    // Step 4: Upload document
    await uploadDocument(presignedUrl, markdown);

    // Step 5: Create source
    const sourceId = await createSource(corpusId, documentId);

    console.log();
    console.log('='.repeat(60));
    console.log('Corpus Created Successfully!');
    console.log('='.repeat(60));
    console.log();
    console.log(`Corpus ID: ${corpusId}`);
    console.log(`Source ID: ${sourceId}`);
    console.log(`Document ID: ${documentId}`);
    console.log();
    console.log('Next steps:');
    console.log('1. Reference this corpus in your Ultravox call configuration');
    console.log('2. Use corpusIds parameter when creating calls:');
    console.log(`   corpusIds: ["${corpusId}"]`);
    console.log('3. The AI will now have access to pet breed information during calls');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
