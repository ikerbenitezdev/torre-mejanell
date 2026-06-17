import fs from 'fs/promises';
import path from 'path';

const SITE = 'https://castelldemejanell.com';
const basePaths: Record<string, string> = { ca: '/', es: '/es/', en: '/en/' };

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(res)));
    } else if (entry.isFile() && (res.endsWith('.astro') || res.endsWith('.md') || res.endsWith('.mdx'))) {
      files.push(res);
    }
  }
  return files;
}

function extractFrontmatter(content: string) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end + 1);
  // simple parsing: look for lines starting with export const key = 'value'
  const result: Record<string, string> = {};
  const lines = fm.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/export\s+const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

export async function GET() {
  const pagesDir = path.join(process.cwd(), 'src', 'pages');
  const files = await walk(pagesDir);

  const urls: { loc: string; lastmod: string }[] = [];

  for (const file of files) {
    try {
      // ignore special files
      const rel = path.relative(pagesDir, file);
      if (rel.startsWith('_')) continue;
      // read file
      const content = await fs.readFile(file, 'utf8');
      const fm = extractFrontmatter(content);
      if (!fm || !fm.lang) continue; // only include pages that declare lang
      const lang = fm.lang;
      const slug = fm.slug ?? '';
      const base = basePaths[lang] ?? '/';
      const normSlug = slug ? (slug.startsWith('/') ? slug.slice(1) : slug) : '';
      let urlPath = base;
      if (normSlug) urlPath = `${base}${normSlug}/`;

      const loc = new URL(urlPath, SITE).toString();
      const stat = await fs.stat(file);
      const lastmod = stat.mtime.toISOString();
      urls.push({ loc, lastmod });
    } catch (err) {
      // ignore individual file errors
      // eslint-disable-next-line no-console
      console.warn('sitemap: skipping', file, err);
    }
  }

  // remove duplicates by loc
  const seen = new Set<string>();
  const unique = urls.filter((u) => (seen.has(u.loc) ? false : seen.add(u.loc)));

  const xmlParts = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const u of unique) {
    xmlParts.push('  <url>');
    xmlParts.push(`    <loc>${u.loc}</loc>`);
    xmlParts.push(`    <lastmod>${u.lastmod}</lastmod>`);
    xmlParts.push('  </url>');
  }
  xmlParts.push('</urlset>');
  const xml = xmlParts.join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
