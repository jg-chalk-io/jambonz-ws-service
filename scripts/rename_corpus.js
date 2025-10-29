require('dotenv').config();

const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const CORPUS_ID = '95d3ce86-4bfd-45e9-8e13-4b9d6748f949';
const NEW_NAME = 'popularPetsCorpus';

async function renameCorpus() {
  console.log(`Renaming corpus ${CORPUS_ID} to "${NEW_NAME}"...`);

  const response = await fetch(`https://api.ultravox.ai/api/corpora/${CORPUS_ID}`, {
    method: 'PATCH',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: NEW_NAME
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to rename corpus: ${error}`);
  }

  const result = await response.json();
  console.log('✓ Corpus renamed successfully!');
  console.log(`  New name: ${result.name}`);
  console.log(`  Description: ${result.description}`);
  console.log(`  Corpus ID: ${result.corpusId}`);
}

renameCorpus().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
