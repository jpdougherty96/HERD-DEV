import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Calendar, Image as ImageIcon, MessageSquare, Tag, Trash2, User, ArrowLeft, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { PhotoLightbox } from "./PhotoLightbox";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { BulletinMessageModal } from "./BulletinMessageModal";
import type { Post, User as UserType } from "../types/domain";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type BulletinDetailProps = {
  post: Post;
  user: UserType | null;
  onBack: () => void;
  onDeletePost: (postId: string) => void;
  onRequireAuth: () => void;
  onUpdatePost: (postId: string, updates: { title: string; content: string; category: string }) => Promise<boolean>;
};

const categoryClassName = (category: string) => {
  const palette: Record<string, string> = {
    "General Discussion": "bg-[#556B2F] text-[#f8f9f6]",
    "Tips & Tricks": "bg-[#c54a2c] text-[#f8f9f6]",
    "Equipment Sharing": "bg-[#a8b892] text-[#2d3d1f]",
    "Local Events": "bg-[#8b7355] text-[#f8f9f6]",
    "Questions & Help": "bg-[#6b8ba3] text-[#f8f9f6]",
    "Success Stories": "bg-[#689c3a] text-[#f8f9f6]",
    "For Sale/Trade": "bg-[#b8674a] text-[#f8f9f6]",
    "Weather & Seasonal": "bg-[#7a6b8a] text-[#f8f9f6]",
  };
  return palette[category] || "bg-[#556B2F] text-[#f8f9f6]";
};

const formatDateVerbose = (dateString: string) =>
  new Date(dateString).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const BULLETIN_CATEGORIES = [
  "General Discussion",
  "Tips & Tricks",
  "Equipment Sharing",
  "Local Events",
  "Questions & Help",
  "Success Stories",
  "For Sale/Trade",
  "Weather & Seasonal",
];

export function BulletinDetail({
  post,
  user,
  onBack,
  onDeletePost,
  onRequireAuth,
  onUpdatePost,
}: BulletinDetailProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editContent, setEditContent] = useState(post.content);
  const [editCategory, setEditCategory] = useState(post.category || 'General Discussion');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditCategory(post.category || 'General Discussion');
  }, [post.id, post.title, post.content, post.category]);

  const photos = post.photos ?? [];
  const hasPhotos = photos.length > 0;
  const hasMultiplePhotos = photos.length > 1;

  useEffect(() => {
    setCurrentImageIndex(0);
  }, [post.id, photos.length]);
  const openLightboxAt = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const goNextImage = () => {
    if (!hasMultiplePhotos) return;
    setCurrentImageIndex((prev) => (prev + 1) % photos.length);
  };

  const goPrevImage = () => {
    if (!hasMultiplePhotos) return;
    setCurrentImageIndex((prev) => (prev - 1 + photos.length) % photos.length);
  };

  const handleMainImageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLightboxAt(currentImageIndex);
    }
  };
  const displayAuthor = post.author?.trim().length ? post.author.trim() : "Community Member";
  const categoryDisplay = post.category || "General Discussion";
  const canDelete = user && (user.isAdmin || post.authorId === user.id);
  const canMessage = user && post.authorId && user.id !== post.authorId;
  const canEdit = user && (user.isAdmin || post.authorId === user.id);
  const shouldShowMessageButton = !isEditing && (!post.authorId || !user || user.id !== post.authorId);

  const handleDelete = () => {
    const confirmMessage = canDelete && user?.isAdmin && post.authorId !== user?.id
      ? `Are you sure you want to delete "${post.title}" by ${displayAuthor}? This action cannot be undone.`
      : `Are you sure you want to delete "${post.title}"? This action cannot be undone.`;

    if (window.confirm(confirmMessage)) {
      onDeletePost(post.id);
    }
  };

  const handleMessageClick = () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!canMessage) return;
    setShowMessageModal(true);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }

    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    if (!editContent.trim()) {
      setError("Content is required.");
      return;
    }

    setSaving(true);
    setError(null);
    const success = await onUpdatePost(post.id, {
      title: editTitle.trim(),
      content: editContent.trim(),
      category: editCategory,
    });
    setSaving(false);
    if (success) {
      setIsEditing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-[#556B2F] hover:bg-[#e8e9e6] hover:text-[#3c4f21] flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bulletins
        </Button>

        {hasPhotos ? (
          <div className="mb-6">
            <div className="relative bg-gray-100 rounded-lg overflow-hidden">
              <div
                className="relative w-full h-64 md:h-96 cursor-zoom-in outline-none"
                role="button"
                tabIndex={0}
                aria-label="Open photo gallery"
                onClick={() => openLightboxAt(currentImageIndex)}
                onKeyDown={handleMainImageKeyDown}
              >
                <ImageWithFallback
                  src={photos[currentImageIndex]}
                  alt={`${post.title} - Image ${currentImageIndex + 1}`}
                  className="w-full h-full object-cover"
                />

                {hasMultiplePhotos && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        goPrevImage();
                      }}
                      className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        goNextImage();
                      }}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </>
                )}

                {hasMultiplePhotos && (
                  <div className="absolute bottom-4 right-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                    {currentImageIndex + 1} / {photos.length}
                  </div>
                )}
              </div>
            </div>

            {hasMultiplePhotos && (
              <div className="flex gap-2 p-4 bg-white/90 overflow-x-auto">
                {photos.map((photo, index) => (
                  <button
                    key={`${photo}-${index}`}
                    onClick={() => setCurrentImageIndex(index)}
                    className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                      index === currentImageIndex
                        ? 'border-[#556B2F] shadow-md'
                        : 'border-gray-300 hover:border-[#a8b892]'
                    }`}
                  >
                    <ImageWithFallback
                      src={photo}
                      alt={`${post.title} - Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-6 h-64 md:h-96 w-full bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center rounded-lg">
            <div className="text-center text-[#556B2F]">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg opacity-70">No photos available</p>
            </div>
          </div>
        )}

        <Card className="bg-white border-[#a8b892] shadow-lg">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Badge className={`${categoryClassName(categoryDisplay)} px-3 py-1 flex items-center gap-1`}>
                <Tag className="w-3 h-3" />
                {categoryDisplay}
              </Badge>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isEditing) {
                        setIsEditing(false);
                        setError(null);
                        setEditTitle(post.title);
                        setEditContent(post.content);
                        setEditCategory(post.category || 'General Discussion');
                      } else {
                        setIsEditing(true);
                      }
                    }}
                    className="border-[#556B2F] text-[#556B2F] hover:bg-[#f0f4ea]"
                  >
                    <Pencil className="w-4 h-4 mr-1" />
                    {isEditing ? 'Cancel Edit' : 'Edit Post'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="text-[#c54a2c] hover:text-[#b8432a] hover:bg-[#fef2f2]"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            </div>

            <CardTitle className="text-2xl text-[#2d3d1f]">{isEditing ? 'Edit Bulletin' : post.title}</CardTitle>

            <div className="flex flex-wrap items-center gap-4 text-sm text-[#556B2F]">
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" />
                {displayAuthor}
              </span>
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {formatDateVerbose(post.createdAt)}
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {isEditing ? (
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="edit-title">Title</Label>
                    <Input
                      id="edit-title"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-category">Category</Label>
                    <Select
                      value={editCategory}
                      onValueChange={(value: string) => setEditCategory(value)}
                    >
                      <SelectTrigger id="edit-category" className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BULLETIN_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="edit-content">Content</Label>
                    <Textarea
                      id="edit-content"
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      className="mt-1"
                      rows={8}
                      required
                    />
                  </div>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={saving} className="bg-[#556B2F] hover:bg-[#3c4f21] text-white">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setError(null);
                      setEditTitle(post.title);
                      setEditContent(post.content);
                      setEditCategory(post.category || 'General Discussion');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                {post.content && (
                  <div className="rounded-lg bg-[#f8f9f6] p-5 text-[#3c4f21] whitespace-pre-wrap">
                    {post.content}
                  </div>
                )}

                {shouldShowMessageButton && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={handleMessageClick}
                      className="bg-[#556B2F] hover:bg-[#3c4f21] text-white flex items-center gap-2"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Send Message
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <PhotoLightbox
        photos={photos}
        open={lightboxOpen}
        startIndex={currentImageIndex}
        onClose={() => setLightboxOpen(false)}
        onIndexChange={(next) => setCurrentImageIndex(next)}
        title={post.title}
      />

      {showMessageModal && user && canMessage && (
        <BulletinMessageModal
          post={post}
          user={user}
          onClose={() => setShowMessageModal(false)}
          onMessageSent={() => setShowMessageModal(false)}
        />
      )}
    </div>
  );
}
