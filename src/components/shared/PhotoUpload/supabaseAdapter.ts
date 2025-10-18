import { supabase } from "@/utils/supabase/client";
import imageCompression from "browser-image-compression";

export const supabaseAdapter = (opts: {
  bucket: string;
  prefix: string;
  maxSizeMB?: number;
}) => ({
  processFiles: async (files: File[]) => {
    const urls: string[] = [];
    for (const [i, f] of files.entries()) {
      let file = f;
      try {
        const compressed = await imageCompression(file, {
          maxSizeMB: opts.maxSizeMB ?? 1.5,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
        });
        file = compressed as File;
      } catch {
        // skip compression failure
      }

      const filePath = `${opts.prefix}/${Date.now()}-${i}-${file.name}`;
      const { error } = await supabase.storage
        .from(opts.bucket)
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from(opts.bucket).getPublicUrl(filePath);
      urls.push(publicUrl);
    }
    return urls;
  },
  remove: async (url: string) => {
    const key = url.split(`${opts.bucket}/`)[1];
    if (key) await supabase.storage.from(opts.bucket).remove([key]);
  },
});
