-- Délai inter-caractères plus tolérant (PC lents / ports USB chargés) : 50 → 70 ms.
UPDATE settings
   SET value = '{"suffix":"Enter","maxInterval":70,"minLength":4,"dedupeMs":250,"sound":true,"idleTimeout":150}',
       updated_at = datetime('now')
 WHERE key = 'scanner_config'
   AND value = '{"suffix":"Enter","maxInterval":50,"minLength":4,"dedupeMs":250,"sound":true,"idleTimeout":120}';
