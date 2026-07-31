Pod::Spec.new do |s|
  s.name           = 'HealzUploadBridge'
  s.version        = '0.1.0'
  s.summary        = 'Private medical-document import and WebView handoff for Healz.'
  s.description    = 'Copies explicitly shared files into protected app storage, validates their contents, and stages a bounded WebView upload.'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'Healz'
  s.homepage       = 'https://healz.ai'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/B1llioner/healz-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
