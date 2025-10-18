export const dataUrlAdapter = () => ({
  processFiles: async (files: File[]) => {
    const urls: string[] = [];
    for (const file of files) {
      const reader = new FileReader();
      const result = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      urls.push(result);
    }
    return urls;
  },
});
