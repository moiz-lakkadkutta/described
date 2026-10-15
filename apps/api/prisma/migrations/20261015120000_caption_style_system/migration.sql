-- DESC-035: new profiles follow the Fire TV caption style ('system', "Match Fire TV") unless the viewer picks Box or
-- Shadow in Settings. Existing rows keep what they have: a stored 'box' may be a real choice, so it is not rewritten.
ALTER TABLE "Profile" ALTER COLUMN "captionStyle" SET DEFAULT 'system';
