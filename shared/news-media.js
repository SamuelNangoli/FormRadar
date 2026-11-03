export function guardianThumbnailUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||!['media.guim.co.uk','i.guim.co.uk'].includes(url.hostname)||url.port||url.username||url.password||url.searchParams.has('api-key'))return null;
    return url.href;
  }catch{return null;}
}
