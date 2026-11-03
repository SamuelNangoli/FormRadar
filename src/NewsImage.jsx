import React,{useState} from 'react';
import {Newspaper} from 'lucide-react';
import {guardianThumbnailUrl} from '../shared/news-media.js';

export default function NewsImage({article,className=''}) {
  const [failed,setFailed]=useState(null),src=guardianThumbnailUrl(article.thumbnail);
  return <div className={`news-picture ${className}`}>
    {src&&failed!==src?<img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:<span className="news-picture-empty"><Newspaper size={30}/><span>No image supplied</span></span>}
  </div>;
}
