import { BountyApp } from "components/bounty-app"
import { MessengerScreen } from "components/messenger-screen"
import { PostingsScreen } from "components/postings-screen"
import { ProfileScreen } from "components/profile-screen"
import { SearchScreen } from "components/search-screen"
import { WalletScreen } from "components/wallet-screen"
import { 
  MaterialIcons,
  Ionicons 
} from "@expo/vector-icons"
import React, { useEffect, useState } from "react"
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Calendar } from "components/ui/calendar"
import { NavigationMenu } from "components/ui/navigation-menu"


export default function index() {
  <SafeAreaView className="flex-1">
    <StatusBar barStyle="dark-content" />

    <BountyApp />
    <NavigationMenu />
  </SafeAreaView>
  return <BountyApp />
}