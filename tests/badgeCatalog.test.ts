import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_BADGE_IDS, KYO_BADGES } from '../src/badgeCatalog';

describe('Kyo first-edition badge collection', () => {
  it('keeps six stable achievement identities, titles and milestone definitions', () => {
    expect(KYO_BADGES.map(({ id }) => id)).toEqual(['first-workout', 'workouts-10', 'workouts-25', 'streak-2', 'streak-4', 'personal-best']);
    expect(KYO_BADGES.map(({ title }) => title)).toEqual(['Despertar', 'En la zona', 'Garra firme', 'Ritmo felino', 'Instinto constante', 'Nueva forma']);
    expect(KYO_BADGES.map(({ requirement }) => requirement)).toEqual(['1 entrenamiento', '10 entrenamientos', '25 entrenamientos', '2 semanas seguidas', '4 semanas seguidas', '1 marca personal']);
    expect(KYO_BADGES.map(({ artwork }) => artwork)).toEqual([
      '/badges/kyo-despertar.svg', '/badges/kyo-en-la-zona.svg', '/badges/kyo-garra-firme.svg',
      '/badges/kyo-ritmo-felino.svg', '/badges/kyo-instinto-constante.svg', '/badges/kyo-nueva-forma.svg',
    ]);
    expect(new Set(KYO_BADGES.map(({ accent }) => accent)).size).toBeGreaterThanOrEqual(4);
    expect(ALL_BADGE_IDS).toContain('workouts-50');
    expect(ALL_BADGE_IDS).toContain('streak-8');
  });

  it('ships hand-authored local SVG masters and 1024px RGBA transparent deliverables for all six', () => {
    for (const badge of KYO_BADGES) {
      const svg = readFileSync(join(process.cwd(), 'public', badge.artwork.slice(1)), 'utf8');
      expect(svg).toContain('<title>Kyo ·');
      expect(svg).toContain('viewBox="0 0 256 256"');
      expect(svg).not.toMatch(/<script\b|<image\b|(?:href|src)="https?:/i);
      expect(svg).not.toMatch(/<text\b/);

      const png = readFileSync(join(process.cwd(), 'docs', 'design', 'kyo', badge.artwork.split('/').pop()!.replace('.svg', '.png')));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(1024);
      expect(png.readUInt32BE(20)).toBe(1024);
      expect(png[25]).toBe(6); // RGBA, with an alpha channel.
    }
  });
});
