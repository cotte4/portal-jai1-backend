/**
 * Knowledge Base Ingestion Script
 *
 * Reads the knowledge base markdown file, chunks it, generates embeddings,
 * and stores everything in the database for RAG.
 *
 * Usage:
 *   npx ts-node src/scripts/ingest-knowledge.ts [path-to-knowledge-base.md]
 *
 * If no path is provided, defaults to ../../N8N-BOT-KNOWLEDGE-BASE.md
 */

import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_KB_PATH = path.join(__dirname, '../../../N8N-BOT-KNOWLEDGE-BASE.md');

interface ChunkInput {
  section: string;
  content: string;
  metadata: Record<string, unknown>;
}

async function main() {
  console.log('=== Knowledge Base Ingestion ===\n');

  // Check for OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY environment variable not set');
    console.log('Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  // Get knowledge base path
  const kbPath = process.argv[2] || DEFAULT_KB_PATH;
  const absolutePath = path.isAbsolute(kbPath) ? kbPath : path.resolve(kbPath);

  console.log(`Knowledge base path: ${absolutePath}`);

  // Read the markdown file
  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: File not found: ${absolutePath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(absolutePath, 'utf-8');
  console.log(`Read ${markdown.length} characters\n`);

  // Parse markdown into chunks
  const chunks = parseMarkdownIntoChunks(markdown);
  console.log(`Parsed ${chunks.length} chunks\n`);

  // Show sample chunks
  console.log('Sample chunks:');
  for (const chunk of chunks.slice(0, 3)) {
    console.log(`  - [${chunk.section}] ${chunk.content.slice(0, 60)}...`);
  }
  console.log();

  // Initialize OpenAI
  const openai = new OpenAI({ apiKey });

  // Generate embeddings
  console.log('Generating embeddings...');
  const texts = chunks.map((c) => `${c.section}\n\n${c.content}`);
  const embeddings = await generateEmbeddings(openai, texts);
  console.log(`Generated ${embeddings.length} embeddings\n`);

  // Initialize Prisma
  const prisma = new PrismaClient();

  try {
    // Clear existing chunks
    console.log('Clearing existing knowledge chunks...');
    await prisma.$executeRaw`TRUNCATE TABLE knowledge_chunks`;

    // Insert new chunks
    console.log('Inserting new chunks...');
    let inserted = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const embeddingStr = `[${embedding.join(',')}]`;

      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks (section, content, embedding, metadata)
        VALUES (
          ${chunk.section},
          ${chunk.content},
          ${embeddingStr}::vector,
          ${JSON.stringify(chunk.metadata)}::jsonb
        )
      `;

      inserted++;
      if (inserted % 10 === 0) {
        process.stdout.write(`  Inserted ${inserted}/${chunks.length}\r`);
      }
    }

    console.log(`\n\nSuccessfully ingested ${inserted} knowledge chunks!`);

    // Verify
    const count = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM knowledge_chunks WHERE embedding IS NOT NULL
    `;
    console.log(`Verification: ${count[0].count} chunks with embeddings in database`);
  } finally {
    await prisma.$disconnect();
  }
}

function parseMarkdownIntoChunks(markdown: string): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  const lines = markdown.split('\n');

  let currentSection = 'General';
  let currentSubsection = '';
  let currentContent: string[] = [];

  const flushChunk = () => {
    const content = currentContent.join('\n').trim();
    if (content.length > 50) {
      chunks.push({
        section: currentSubsection || currentSection,
        content,
        metadata: {
          mainSection: currentSection,
          subsection: currentSubsection || undefined,
        },
      });
    }
    currentContent = [];
  };

  for (const line of lines) {
    // Main section (## TITLE)
    if (line.startsWith('## ')) {
      flushChunk();
      currentSection = line.replace('## ', '').trim();
      currentSubsection = '';
      continue;
    }

    // Subsection (### Title)
    if (line.startsWith('### ')) {
      flushChunk();
      currentSubsection = line.replace('### ', '').trim();
      continue;
    }

    // Skip table of contents and index
    if (line.includes('INDICE') || line.match(/^\d+\.\s*\[/)) {
      continue;
    }

    currentContent.push(line);
  }

  flushChunk();
  return chunks;
}

async function generateEmbeddings(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const batchSize = 100;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    for (const item of response.data) {
      embeddings.push(item.embedding);
    }

    process.stdout.write(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}\r`);
  }

  console.log();
  return embeddings;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
