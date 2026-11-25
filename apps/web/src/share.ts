export const storyLink = (id: string, origin = location.origin) => `${origin}/story?id=${encodeURIComponent(id)}`;
export async function shareStory(id: string, title: string): Promise<string> {
  const url = storyLink(id);
  try {
    if (navigator.share) { await navigator.share({ title, url }); return ''; }
    await navigator.clipboard.writeText(url);
    return 'Story link copied';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? '' : `Share this link: ${url}`;
  }
}
