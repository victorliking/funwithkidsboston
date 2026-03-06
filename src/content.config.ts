import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.string().optional(),
      category: z.enum([
        'Things To Do',
        'Day Trips',
        'Gear & Reviews',
        'Seasonal Guides',
      ]),
      ageRange: z.string().optional(),
      tags: z.array(z.string()).optional(),
      affiliateDisclosure: z.boolean().default(true),
    }),
});

export const collections = { blog };