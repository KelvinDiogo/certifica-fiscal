-- Keep multipart uploads below Vercel's 4.5 MB request payload limit.
update storage.buckets set file_size_limit=4194304 where id='fiscal-certificates';
