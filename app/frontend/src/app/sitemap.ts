import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://open-regime.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://open-regime.com/signals/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: 'https://open-regime.com/dashboard/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: 'https://open-regime.com/liquidity/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: 'https://open-regime.com/employment/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: 'https://open-regime.com/holdings/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.6 },
  ];
}
