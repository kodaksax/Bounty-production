"use client"

import { MaterialIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { 
  ActivityIndicator, 
  Image, 
  Modal, 
  ScrollView, 
  Text, 
  TouchableOpacity, 
  View 
} from "react-native";
import { useFollow } from "hooks/useFollow";
import { usePortfolio } from "hooks/usePortfolio";
import { useProfile } from "hooks/useProfile";
import type { PortfolioItem } from "lib/types";

interface EnhancedProfileSectionProps {
  userId?: string;
  isOwnProfile?: boolean;
}

export function EnhancedProfileSection({ 
  userId, 
  isOwnProfile = true 
}: EnhancedProfileSectionProps) {
  const { profile, loading: profileLoading } = useProfile(userId);
  const { items, loading: portfolioLoading, deleteItem } = usePortfolio(userId || 'current-user');
  const { 
    isFollowing, 
    followerCount, 
    followingCount, 
    toggleFollow,
    loading: followLoading 
  } = useFollow(userId || 'current-user');

  const [selectedPortfolioItem, setSelectedPortfolioItem] = useState<PortfolioItem | null>(null);

  if (profileLoading) {
    return (
      <View className="p-4 items-center">
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="p-4">
        <Text className="text-center text-emerald-200">Profile not found</Text>
      </View>
    );
  }

  const renderVerificationBadge = () => {
    const { verificationStatus } = profile;
    
    if (!verificationStatus || verificationStatus === 'unverified') {
      return null;
    }

    const config = {
      pending: { icon: 'schedule', color: '#fbbf24', label: 'Pending' },
      verified: { icon: 'verified', color: '#10b981', label: 'Verified' },
    }[verificationStatus];

    if (!config) return null;

    return (
      <View className="flex-row items-center mt-2">
        <MaterialIcons name={config.icon as any} size={16} color={config.color} />
        <Text className="text-xs ml-1" style={{ color: config.color }}>
          {config.label}
        </Text>
      </View>
    );
  };

  const handleDeletePortfolioItem = async (itemId: string) => {
    if (confirm('Are you sure you want to delete this portfolio item?')) {
      await deleteItem(itemId);
    }
  };

  return (
    <View className="px-4 py-2">
      {/* Enhanced Profile Header */}
      <View className="bg-black/30 backdrop-blur-sm rounded-xl p-4 mb-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center flex-1">
            <View className="relative">
              <View className="h-16 w-16 rounded-full bg-emerald-700 flex items-center justify-center">
                <MaterialIcons name="person" size={32} color="#d1fae5" />
              </View>
              {renderVerificationBadge()}
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-lg font-bold">{profile.name || profile.username}</Text>
              <Text className="text-xs text-emerald-300">{profile.username}</Text>
              {profile.title && (
                <Text className="text-sm text-emerald-200 mt-1">{profile.title}</Text>
              )}
            </View>
          </View>

          {!isOwnProfile && (
            <TouchableOpacity 
              onPress={toggleFollow}
              disabled={followLoading}
              className={`px-4 py-2 rounded-lg ${
                isFollowing ? 'bg-emerald-700' : 'bg-emerald-500'
              }`}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-white text-sm font-medium">
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Bio */}
        {profile.bio && (
          <Text className="text-sm text-emerald-200 mt-3">{profile.bio}</Text>
        )}

        {/* Stats Row */}
        <View className="flex-row justify-around mt-4 pt-3 border-t border-emerald-500/30">
          <View className="items-center">
            <Text className="text-xl font-bold">{followerCount}</Text>
            <Text className="text-xs text-emerald-300">Followers</Text>
          </View>
          <View className="items-center">
            <Text className="text-xl font-bold">{followingCount}</Text>
            <Text className="text-xs text-emerald-300">Following</Text>
          </View>
          <View className="items-center">
            <Text className="text-xl font-bold">{items.length}</Text>
            <Text className="text-xs text-emerald-300">Portfolio</Text>
          </View>
        </View>
      </View>

      {/* Languages & Skills */}
      {(profile.languages && profile.languages.length > 0) && (
        <View className="mb-4">
          <Text className="text-sm font-medium mb-2">Languages</Text>
          <View className="flex-row flex-wrap gap-2">
            {profile.languages.map((lang, idx) => (
              <View key={idx} className="bg-emerald-700/50 px-3 py-1 rounded-full">
                <Text className="text-xs text-emerald-100">{lang}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {(profile.skills && profile.skills.length > 0) && (
        <View className="mb-4">
          <Text className="text-sm font-medium mb-2">Skills</Text>
          <View className="flex-row flex-wrap gap-2">
            {profile.skills.map((skill, idx) => (
              <View key={idx} className="bg-emerald-500/30 px-3 py-1 rounded-full border border-emerald-500">
                <Text className="text-xs text-emerald-100">{skill}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Portfolio Section */}
      <View className="mb-4">
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-sm font-medium">Portfolio</Text>
          {isOwnProfile && (
            <TouchableOpacity className="px-2 py-1 bg-emerald-500 rounded">
              <Text className="text-xs text-white">Add Item</Text>
            </TouchableOpacity>
          )}
        </View>

        {portfolioLoading ? (
          <View className="items-center py-4">
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        ) : items.length === 0 ? (
          <View className="bg-emerald-700/20 p-4 rounded-lg">
            <Text className="text-center text-emerald-300 text-sm">
              {isOwnProfile ? 'Add your first portfolio item' : 'No portfolio items yet'}
            </Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-3">
              {items.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  className="relative"
                  onPress={() => setSelectedPortfolioItem(item)}
                >
                  <View className="w-32 h-32 bg-emerald-700 rounded-lg overflow-hidden">
                    <Image 
                      source={{ uri: item.thumbnail || item.url }} 
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    {item.type === 'video' && (
                      <View className="absolute inset-0 items-center justify-center">
                        <View className="bg-black/50 rounded-full p-2">
                          <MaterialIcons name="play-arrow" size={24} color="white" />
                        </View>
                      </View>
                    )}
                  </View>
                  {isOwnProfile && (
                    <TouchableOpacity
                      className="absolute top-1 right-1 bg-red-500 rounded-full p-1"
                      onPress={() => handleDeletePortfolioItem(item.id)}
                    >
                      <MaterialIcons name="close" size={16} color="white" />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Portfolio Detail Modal */}
      <Modal
        visible={!!selectedPortfolioItem}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPortfolioItem(null)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/80 items-center justify-center"
          activeOpacity={1}
          onPress={() => setSelectedPortfolioItem(null)}
        >
          <View className="bg-emerald-800 rounded-xl p-4 m-4 max-w-lg w-full">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-lg font-bold text-white">Portfolio Item</Text>
              <TouchableOpacity onPress={() => setSelectedPortfolioItem(null)}>
                <MaterialIcons name="close" size={24} color="white" />
              </TouchableOpacity>
            </View>
            
            {selectedPortfolioItem && (
              <>
                <Image
                  source={{ uri: selectedPortfolioItem.url }}
                  className="w-full h-64 rounded-lg mb-3"
                  resizeMode="contain"
                />
                {selectedPortfolioItem.title && (
                  <Text className="text-base font-medium text-white mb-2">
                    {selectedPortfolioItem.title}
                  </Text>
                )}
                {selectedPortfolioItem.description && (
                  <Text className="text-sm text-emerald-200">
                    {selectedPortfolioItem.description}
                  </Text>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Join Date */}
      <View className="mt-2 flex-row items-center">
        <MaterialIcons name="calendar-today" size={14} color="#a7f3d0" />
        <Text className="text-xs text-emerald-300 ml-1">
          Joined {new Date(profile.joinDate).toLocaleDateString('en-US', { 
            month: 'long', 
            year: 'numeric' 
          })}
        </Text>
      </View>
    </View>
  );
}
