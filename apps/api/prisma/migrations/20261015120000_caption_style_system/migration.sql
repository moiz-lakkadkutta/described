-- DESC-035: captions follow the Fire TV caption style unless the viewer picks Box or Shadow in Settings.
-- 'box' was the default, so a stored 'box' was never a choice: it becomes 'system'. 'shadow' was a choice and stays.
ALTER TABLE "Profile" ALTER COLUMN "captionStyle" SET DEFAULT 'system';
UPDATE "Profile" SET "captionStyle" = 'system' WHERE "captionStyle" = 'box';
