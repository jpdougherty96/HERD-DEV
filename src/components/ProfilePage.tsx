import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Camera, X, User } from "lucide-react";
import { ProfilePicturePicker } from "./ProfilePicturePicker";
import { supabase } from "@/utils/supabaseClient";
import { toast } from "sonner";


type Profile = {
  id: string;
  name: string;
  email?: string;
  farmName?: string;
  bio?: string;
  location?: string;
  avatar_url?: string; // file path
  stripe_connected?: boolean;
};

type ProfilePageProps = {
  user: Profile;
  onUpdate: (user: Profile) => void;
};

export function ProfilePage({ user, onUpdate }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [showStripeGuide, setShowStripeGuide] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    farmName: "",
    bio: "",
    location: "",
  });
  const [profileImage, setProfileImage] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);

  // ✅ Always reload profile from Supabase and resolve signed URL
  useEffect(() => {
    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Failed to load profile:", error);
        return;
      }

      setFormData({
        name: data.full_name ?? "",
        farmName: data.farm_name ?? "",
        bio: data.bio ?? "",
        location: data.location ?? "",
      });

      if (data.avatar_url) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(data.avatar_url, 60 * 60 * 24 * 7);
        setProfileImage(signed?.signedUrl ?? "");
      } else {
        setProfileImage("");
      }

      onUpdate({
        id: data.id,
        name: data.full_name,
        email: data.email,
        farmName: data.farm_name,
        bio: data.bio,
        location: data.location,
        avatar_url: data.avatar_url,
        stripe_connected: data.stripe_connected,
      });
    };

    loadProfile();
  }, [user.id]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser?.user) throw new Error("Not authenticated");

      let avatarFileName = user.avatar_url ?? "";

      if (newImageFile) {
        const userId = currentUser.user.id;
        avatarFileName = `${userId}-${Date.now()}.jpg`;

        // upload new file
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(avatarFileName, newImageFile, { upsert: true });
        if (uploadError) throw uploadError;

        // cleanup old files
        const { data: listData } = await supabase.storage
          .from("avatars")
          .list("", { search: userId });
        if (listData) {
          const oldFiles = listData
            .map((f) => f.name)
            .filter((n) => n !== avatarFileName);
          if (oldFiles.length > 0) {
            await supabase.storage.from("avatars").remove(oldFiles);
          }
        }
      }

      const updates = {
        full_name: formData.name ?? "",
        farm_name: formData.farmName ?? "",
        bio: formData.bio ?? "",
        location: formData.location ?? "",
        avatar_url: avatarFileName,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", currentUser.user.id)
        .select()
        .single();

      if (error) throw error;

      let signedUrl = "";
      if (avatarFileName) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(avatarFileName, 60 * 60 * 24 * 7);
        signedUrl = signed?.signedUrl ?? "";
        setProfileImage(signedUrl);
      }

      const updatedUser: Profile = {
        id: data.id,
        name: data.full_name,
        email: data.email,
        farmName: data.farm_name,
        bio: data.bio,
        location: data.location,
        avatar_url: avatarFileName,
        stripe_connected: data.stripe_connected,
      };

      onUpdate(updatedUser);
      setIsEditing(false);
      setNewImageFile(null);
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Error saving profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (file: File, previewUrl: string) => {
    setNewImageFile(file);
    setProfileImage(previewUrl);
  };

  const handleImageRemove = () => {
    setProfileImage("");
    setNewImageFile(null);
  };

  // ✅ Stripe connect flow with error logs + redirect
  const handleStripeConnect = async () => {
    setStripeLoading(true);

    try {
      if (!user?.id) throw new Error("No user ID available for Stripe connect.");

      console.log("🚀 Connecting Stripe for user:", user.id);

      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { userId: user.id },
      });

      if (error) {
        console.error("❌ Supabase function error:", error);
        throw error;
      }

      if (!data?.url) throw new Error("Stripe connect function did not return a URL.");

      // redirect to onboarding in same tab
      window.location.href = data.url;
    } catch (err: any) {
      console.error("Stripe connect error:", err.message || err);
      toast.error("Stripe connection FAILED: " + (err.message || "Unknown error"));
    } finally {
      setStripeLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Hero */}
      <div
        className="relative h-48 bg-cover bg-center mb-8 rounded-lg overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(rgba(85, 107, 47, 0.7), rgba(85, 107, 47, 0.7)), url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080')",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white px-6">
            <h1 className="text-3xl md:text-4xl mb-2 text-white">Your Profile</h1>
            <p className="text-lg text-white opacity-90">Manage your HERD community presence</p>
          </div>
        </div>
      </div>

      {/* Main Profile Card */}
      <Card className="bg-white border-[#a8b892] shadow-lg mb-6">
        <CardHeader className="bg-[#556B2F] text-white rounded-t-lg">
          <CardTitle className="flex items-center gap-2 text-white">
            <User className="w-5 h-5" />
            {isEditing ? "Edit Your Profile" : "Profile Information"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {isEditing ? (
            <div className="space-y-6">
              <ProfilePicturePicker
                currentImage={profileImage}
                onImageChange={handleImageChange}
                onRemove={handleImageRemove}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label>Full Name *</Label>
                  <Input
                    value={formData.name ?? ""}
                    onChange={(e) => handleChange("name", e.target.value)}
                    required
                    className="border-2 border-black focus-visible:border-black focus-visible:ring-black/20"
                  />
                </div>
                <div>
                  <Label>Farm/Property Name</Label>
                  <Input
                    value={formData.farmName ?? ""}
                    onChange={(e) => handleChange("farmName", e.target.value)}
                    className="border-2 border-black focus-visible:border-black focus-visible:ring-black/20"
                  />
                </div>
              </div>

              <div>
                <Label>Location</Label>
                <Input
                  value={formData.location ?? ""}
                  onChange={(e) => handleChange("location", e.target.value)}
                  placeholder="City, State"
                  className="border-2 border-black focus-visible:border-black focus-visible:ring-black/20"
                />
              </div>

              <div>
                <Label>About You</Label>
                <Textarea
                  value={formData.bio ?? ""}
                  onChange={(e) => handleChange("bio", e.target.value)}
                  rows={4}
                  className="border-2 border-black focus-visible:border-black focus-visible:ring-black/20"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setIsEditing(false);
                    setNewImageFile(null);
                  }}
                  className="bg-[#c54a2c] text-white hover:bg-[#b8432a]"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col md:flex-row gap-6 items-start">
                <div className="w-32 h-32 rounded-full bg-gray-100 border-4 border-[#a8b892] overflow-hidden">
                  {profileImage ? (
                    <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-10 h-10 text-[#556B2F]" />
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl text-[#1f2b15]">{formData.name}</h2>
                  {formData.farmName && <p className="text-[#2d3d1f]/90">{formData.farmName}</p>}
                  {formData.location && <p className="text-[#2d3d1f]/80">{formData.location}</p>}
                  {formData.bio && <p className="mt-2 text-[#2d3d1f]/80">{formData.bio}</p>}
                </div>
              </div>
              <div className="pt-4 border-t mt-4">
                <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stripe Card */}
      <Card className="bg-white border-[#a8b892] shadow-lg">
        <CardHeader className="bg-[#556B2F] text-white rounded-t-lg">
          <CardTitle className="text-white">Payment & Teaching Setup</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {user.stripe_connected ? (
            <div className="inline-flex items-center rounded-full bg-[#dce8cc] px-4 py-2 text-sm font-medium text-[#2d3d1f]">
              Connected & Ready
            </div>
          ) : (
            <>
              <Button onClick={handleStripeConnect} disabled={stripeLoading}>
                {stripeLoading ? "Connecting..." : "Connect Stripe Account"}
              </Button>
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowStripeGuide((prev) => !prev)}
                >
                  {showStripeGuide ? "Hide Stripe Onboarding Guide" : "View Stripe Onboarding Guide"}
                </Button>
              </div>
              {showStripeGuide && (
                <div className="mt-4 max-h-[60vh] overflow-y-auto pr-2 text-sm text-[#2d3d1f] space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-[#1f2b15]">Getting Paid on HERD</h3>
                    <p className="text-[#556B2F]">
                      Stripe is the same payment system used by platforms like Airbnb, Shopify, and Lyft. This guide
                      walks you through what to choose during onboarding.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Why Stripe is required</h4>
                    <ul className="mt-2 space-y-1 text-[#556B2F]">
                      <li>• Collect payments from guests</li>
                      <li>• Hold funds safely until a booking is complete</li>
                      <li>• Deposit money directly into your bank account</li>
                      <li>• Generate tax documents when required (1099s)</li>
                    </ul>
                    <p className="mt-2 text-[#556B2F]">
                      HERD never sees your full bank or SSN details. That information goes directly to Stripe.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Step-by-step: what to choose</h4>
                    <ol className="mt-2 space-y-3 text-[#556B2F]">
                      <li>
                        <strong>1. Business type:</strong> Most hosts should pick <strong>Individual / Sole proprietor</strong>.
                        Choose this if you do not have an LLC or corporation. If you do, choose <strong>Company</strong>.
                      </li>
                      <li>
                        <strong>2. Industry / category:</strong> Best matches are <strong>Education & Instruction</strong>,
                        <strong> Personal Services</strong>, or <strong>Other → Community / Instructional Services</strong>.
                        Avoid financial services, gambling, or crypto.
                      </li>
                      <li>
                        <strong>3. What you are selling:</strong> Keep it simple, e.g. “In-person educational workshops,”
                        “Hands-on homesteading classes,” or “Short-term equipment rentals.”
                      </li>
                      <li>
                        <strong>4. Bank account:</strong> Use a checking account. Personal or business accounts both work.
                        Savings accounts usually do not.
                      </li>
                      <li>
                        <strong>5. Identity verification:</strong> Stripe may ask for your legal name, DOB, last 4 digits
                        of SSN (US), and address. This is required by law and stored by Stripe.
                      </li>
                      <li>
                        <strong>6. Tax information:</strong> If you cross IRS thresholds, Stripe may issue a 1099 at year-end.
                        Stripe handles the form; HERD does not withhold taxes.
                      </li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Equipment rentals + classes</h4>
                    <p className="text-[#556B2F]">
                      Whether you offer classes, equipment rentals, or both, Stripe treats this as services paid through
                      an online platform. No special category is required.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Payout timing</h4>
                    <p className="text-[#556B2F]">
                      Funds are held when a booking is made and released 7 days after the class or rental is completed.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Common problems & fixes</h4>
                    <ul className="mt-2 space-y-1 text-[#556B2F]">
                      <li>• “Account incomplete” → Open the Stripe link and complete missing fields.</li>
                      <li>• “Payouts delayed” → Bank not verified, identity verification incomplete, or first payout delay.</li>
                      <li>• “Do I need an LLC?” → No. Many hosts operate as individuals.</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Safety & trust</h4>
                    <ul className="mt-2 space-y-1 text-[#556B2F]">
                      <li>• Stripe is PCI-compliant (bank-level security)</li>
                      <li>• HERD never stores your sensitive financial info</li>
                      <li>• You can update bank details anytime in Stripe</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-[#1f2b15]">Need help?</h4>
                    <p className="text-[#556B2F]">
                      If Stripe asks confusing questions, contact HERD support or use Stripe support from your Stripe
                      dashboard. We are happy to help you get set up and earning.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
