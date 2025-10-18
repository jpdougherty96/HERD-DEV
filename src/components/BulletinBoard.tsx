import React, { useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { MessageSquare, Plus, User, Tag, Image as ImageIcon, Trash2 } from 'lucide-react';
import { PhotoPicker } from './PhotoPicker';
import type { Post, User as UserType } from '../App';

type BulletinBoardProps = {
  posts: Post[];
  onCreatePost: (post: Omit<Post, 'id' | 'createdAt' | 'authorId'>) => void;
  onDeletePost: (postId: string) => void;
  onSelectPost: (post: Post) => void;
  user: UserType | null;
  onRequireAuth: () => void;
};

const categories = [
  'General Discussion',
  'Tips & Tricks',
  'Equipment Sharing',
  'Local Events',
  'Questions & Help',
  'Success Stories',
  'For Sale/Trade',
  'Weather & Seasonal',
];

const categoryClassName = (category: string) => {
  const palette: Record<string, string> = {
    'General Discussion': 'bg-[#556B2F] text-[#f8f9f6]',
    'Tips & Tricks': 'bg-[#c54a2c] text-[#f8f9f6]',
    'Equipment Sharing': 'bg-[#a8b892] text-[#2d3d1f]',
    'Local Events': 'bg-[#8b7355] text-[#f8f9f6]',
    'Questions & Help': 'bg-[#6b8ba3] text-[#f8f9f6]',
    'Success Stories': 'bg-[#689c3a] text-[#f8f9f6]',
    'For Sale/Trade': 'bg-[#b8674a] text-[#f8f9f6]',
    'Weather & Seasonal': 'bg-[#7a6b8a] text-[#f8f9f6]',
  };
  return palette[category] || 'bg-[#556B2F] text-[#f8f9f6]';
};

export function BulletinBoard({
  posts,
  onCreatePost,
  onDeletePost,
  onSelectPost,
  user,
  onRequireAuth,
}: BulletinBoardProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    author: user?.name || '',
    category: 'General Discussion',
    photos: [] as string[],
  });

  const filteredPosts = useMemo(
    () =>
      selectedCategory === 'all'
        ? posts
        : posts.filter((post) => (post.category || 'General Discussion') === selectedCategory),
    [posts, selectedCategory]
  );

  const handlePhotosChange = (newPhotos: string[]) => {
    setFormData((prev) => ({
      ...prev,
      photos: newPhotos,
    }));
  };

  const handleDeletePost = (postId: string, postTitle: string) => {
    const post = posts.find((p) => p.id === postId);
    const isAdminDelete = user?.isAdmin && post?.authorId !== user?.id;
    const confirmMessage = isAdminDelete
      ? `Are you sure you want to delete "${postTitle}" by ${post?.author}? This action cannot be undone.`
      : `Are you sure you want to delete "${postTitle}"? This action cannot be undone.`;

    if (window.confirm(confirmMessage)) {
      onDeletePost(postId);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }

    onCreatePost(formData);
    setFormData({
      title: '',
      content: '',
      author: user.name,
      category: 'General Discussion',
      photos: [],
    });
    setShowForm(false);
  };

  const handleCardActivate = (post: Post) => {
    onSelectPost(post);
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, post: Post) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleCardActivate(post);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-[#2d3d1f] mb-2">Community Bulletin Board</h1>
          <p className="text-[#3c4f21]">
            Share knowledge, ask questions, and connect with fellow homesteaders
          </p>
        </div>

        <Button
          onClick={() => (user ? setShowForm(true) : onRequireAuth())}
          className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Post
        </Button>
      </div>

      {/* Category Filter */}
      <div className="mb-8">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory('all')}
            className={
              selectedCategory === 'all'
                ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#556B2F]'
                : 'border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]'
            }
          >
            All Posts
          </Button>
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              className={
                selectedCategory === category
                  ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#556B2F]'
                  : 'border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]'
              }
            >
              {category}
            </Button>
          ))}
        </div>
      </div>

      {/* Create Post Modal */}
      {showForm && user && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="bg-[#ffffff] border-[#a8b892] max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
              <div className="flex justify-between items-center">
                <CardTitle>Create New Post</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowForm(false)}
                  className="text-[#f8f9f6] hover:bg-[#6B7F3F]"
                >
                  ×
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="author" className="text-[#2d3d1f]">
                    Your Name
                  </Label>
                  <Input
                    id="author"
                    type="text"
                    value={user.name}
                    disabled
                    className="mt-1 bg-gray-100 border-[#a8b892]"
                  />
                </div>

                <div>
                  <Label htmlFor="category" className="text-[#2d3d1f]">
                    Category
                  </Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value: string) =>
                      setFormData((prev) => ({ ...prev, category: value }))
                    }
                  >
                    <SelectTrigger className="mt-1 border-[#b8674a] bg-[#fbeae4] text-[#4c1f12] focus:border-[#c54a2c] focus:ring-[#c54a2c]/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#fdf4f1] border-[#c54a2c]">
                      {categories.map((category) => (
                        <SelectItem
                          key={category}
                          value={category}
                          className="text-[#4c1f12] focus:bg-[#fde0d8] focus:text-[#4c1f12] data-[state=checked]:bg-[#fcd5ca] data-[state=checked]:text-[#4c1f12]"
                        >
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="title" className="text-[#2d3d1f]">
                    Title
                  </Label>
                  <Input
                    id="title"
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, title: e.target.value }))
                    }
                    required
                    className="mt-1 bg-[#ffffff] border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
                    placeholder="What's your post about?"
                  />
                </div>

                <div>
                  <Label htmlFor="content" className="text-[#2d3d1f]">
                    Content
                  </Label>
                  <Textarea
                    id="content"
                    value={formData.content}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, content: e.target.value }))
                    }
                    required
                    className="mt-1 bg-[#ffffff] border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F] resize-none"
                    rows={6}
                    placeholder="Share your thoughts, questions, or information..."
                  />
                </div>

                <div>
                  <Label className="text-[#2d3d1f]">Photos (Optional - Up to 5)</Label>
                  <div className="mt-2">
                    <PhotoPicker photos={formData.photos} onPhotosChange={handlePhotosChange} maxPhotos={5} />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="submit" className="flex-1 bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]">
                    Create Post
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowForm(false)}
                    className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Posts */}
      {filteredPosts.length === 0 ? (
        <Card className="bg-[#ffffff] border-[#a8b892] p-12 text-center">
          <MessageSquare className="h-12 w-12 text-[#a8b892] mx-auto mb-4" />
          <h3 className="text-[#2d3d1f] mb-2">
            {selectedCategory === 'all' ? 'No posts yet' : `No posts in ${selectedCategory}`}
          </h3>
          <p className="text-[#3c4f21] mb-4">Be the first to share something with the community!</p>
          <Button
            onClick={() => (user ? setShowForm(true) : onRequireAuth())}
            className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create First Post
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6">
          {filteredPosts.map((post) => {
            const firstPhoto = post.photos && post.photos.length > 0 ? post.photos[0] : null;
            const displayAuthor = post.author?.trim().length ? post.author.trim() : 'Community Member';

            const canDelete = user && (user.isAdmin || post.authorId === user.id);

            return (
              <Card
                key={post.id}
                role="button"
                tabIndex={0}
                onClick={() => handleCardActivate(post)}
                onKeyDown={(event) => handleCardKeyDown(event, post)}
                className="bg-[#ffffff] border-[#a8b892] shadow-sm hover:shadow-xl transition-all cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#556B2F]"
              >
                <div className="relative">
                  {firstPhoto ? (
                    <img
                      src={firstPhoto}
                      alt={`${post.title} cover`}
                      className="w-full h-56 object-cover"
                    />
                  ) : (
                    <div className="w-full h-56 bg-[#f8f9f6] flex items-center justify-center">
                      <div className="text-center text-[#556B2F]">
                        <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-60" />
                        <p className="text-sm opacity-70">No photo</p>
                      </div>
                    </div>
                  )}
                  <div className="absolute top-4 left-4">
                    <Badge className={`${categoryClassName(post.category)} px-3 py-1 flex items-center gap-1`}>
                      <Tag className="w-3 h-3" />
                      {post.category || 'General Discussion'}
                    </Badge>
                  </div>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeletePost(post.id, post.title);
                      }}
                      className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 text-white hover:bg-black/70"
                      title={user.isAdmin && post.authorId !== user.id ? 'Delete post (Admin privileges)' : 'Delete post'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                <CardContent className="p-5 space-y-3">
                  <CardTitle className="text-xl text-[#2d3d1f]">{post.title}</CardTitle>
                  <p className="text-sm text-[#556B2F] flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {displayAuthor}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
