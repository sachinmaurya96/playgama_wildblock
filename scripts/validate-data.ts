/**
 * `npm run validate:data` — checks blocks, items, recipes, architecture
 * materials, the Build Home catalog and furniture models for broken
 * references, unobtainable ingredients and dependency deadlocks.
 * Exits with code 1 when any error is found.
 */
import { formatReport, validateData } from '../src/data/validation';
import '../src/data/buildCatalog';
import '../src/data/buildChallenges';

const rep = validateData();
console.log(formatReport(rep));
if (rep.errors.length) process.exit(1);
